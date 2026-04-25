// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

use std::collections::HashMap;
use std::io::{BufRead, BufReader};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

use anyhow::{Context, Result};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use rusqlite::Connection;
use tokio::sync::mpsc;

use crate::db;
use crate::ws::EventTx;
use crate::PendingApprovals;

use tokio::sync::oneshot;

const MAX_PAYLOAD: usize = 65_536; // 64 KiB
const SKIP_PERMISSIONS_FLAG: &str = "--dangerously-skip-permissions";

#[allow(clippy::too_many_arguments)]
pub async fn spawn_and_process(
    prompt: &str,
    container: Option<&str>,
    dangerously_skip_permissions: bool,
    work_dir: Option<&str>,
    command: Option<&str>,
    agent: &str,
    session_id: &str,
    kill_rx: oneshot::Receiver<()>,
    db: Arc<Mutex<Connection>>,
    _pending: PendingApprovals,
    events_tx: EventTx,
    input_tokens: Arc<AtomicU64>,
    output_tokens: Arc<AtomicU64>,
    cache_read_tokens: Arc<AtomicU64>,
    secrets: &HashMap<String, String>,
    mut pty_input_rx: tokio::sync::mpsc::Receiver<String>,
) -> Result<()> {
    if !dangerously_skip_permissions {
        write_hook_settings().context("failed to write hook settings")?;
    }

    let env_bin = std::env::var("CLAUDE_BIN").unwrap_or_else(|_| "claude".to_string());
    let claude_bin = if let Some(cmd) = command {
        cmd.to_string()
    } else if agent != "claude" {
        agent.to_string()
    } else {
        env_bin
    };

    // Open a PTY so Claude's isatty() returns true → interactive mode → PreToolUse hooks fire.
    // With --output-format stream-json, output is machine-readable JSON even in TTY mode.
    // Use a very wide column to prevent JSON line wrapping by the PTY.
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: 50,
            cols: 32_767,
            pixel_width: 0,
            pixel_height: 0,
        })
        .context("failed to open PTY")?;

    // When a container name is provided, wrap the command with distrobox-enter so
    // Claude runs inside that container and can access container-only tools.
    let cmd = match container {
        Some(c) => {
            tracing::info!(
                container = c,
                agent,
                dangerously_skip_permissions,
                "spawning agent inside distrobox container"
            );
            let mut cmd = CommandBuilder::new("distrobox-enter");
            let mut args = vec![
                "--name",
                c,
                "--",
                &claude_bin,
                "--output-format",
                "stream-json",
                "--verbose",
            ];
            if dangerously_skip_permissions {
                args.push(SKIP_PERMISSIONS_FLAG);
            }
            args.extend(["-p", prompt]);
            cmd.args(&args);
            cmd
        }
        None => {
            tracing::info!(agent, dangerously_skip_permissions, "spawning agent");
            let mut cmd = CommandBuilder::new(&claude_bin);
            let mut args = vec!["--output-format", "stream-json", "--verbose"];
            if dangerously_skip_permissions {
                args.push(SKIP_PERMISSIONS_FLAG);
            }
            args.extend(["-p", prompt]);
            cmd.args(&args);
            cmd
        }
    };

    let mut cmd = cmd;
    if let Some(dir) = work_dir {
        cmd.cwd(dir);
    }
    cmd.env("NAVETTED_SESSION_ID", session_id);
    for (name, value) in secrets {
        cmd.env(name, value);
    }

    let mut child = pair
        .slave
        .spawn_command(cmd)
        .with_context(|| format!("failed to spawn {claude_bin}"))?;

    // Drop slave end — parent only needs the master.
    drop(pair.slave);

    // PTY master reader (blocking std::io::Read). Bridge to async via channel.
    let reader = pair
        .master
        .try_clone_reader()
        .context("failed to clone PTY master reader")?;

    let (tx, mut rx) = mpsc::channel::<String>(1024);

    tokio::task::spawn_blocking(move || {
        let br = BufReader::new(reader);
        for line in br.lines() {
            match line {
                Ok(l) => {
                    if tx.blocking_send(l).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });

    // PTY stdin writer: bridge async channel to blocking writes.
    let mut writer = pair
        .master
        .take_writer()
        .context("failed to take PTY master writer")?;
    tokio::task::spawn_blocking(move || {
        use std::io::Write;
        while let Some(text) = pty_input_rx.blocking_recv() {
            let with_newline = if text.ends_with('\n') {
                text
            } else {
                format!("{text}\n")
            };
            if writer.write_all(with_newline.as_bytes()).is_err() {
                break;
            }
            let _ = writer.flush();
        }
    });

    let mut event_count: u64 = 0;

    tokio::pin!(kill_rx);
    loop {
        let raw = tokio::select! {
            maybe = rx.recv() => match maybe {
                Some(r) => r,
                None => break,
            },
            result = &mut kill_rx => {
                if result.is_ok() {
                    tracing::info!("kill_session received, killing claude process");
                    let _ = child.kill();
                }
                break;
            },
        };
        {
            // PTYs use \r\n; strip CR and any ANSI escape sequences.
            let line = strip_ansi(raw.trim_end_matches('\r'));
            if line.trim().is_empty() {
                continue;
            }

            // Only store lines that look like JSON events.
            if !line.starts_with('{') {
                tracing::debug!("non-json line from pty: {}", &line[..line.len().min(80)]);
                continue;
            }

            let now = unix_ts();

            // Parse usage fields from the raw line before it may be truncated/consumed.
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
                if let Some(usage) = v.get("usage") {
                    if let Some(n) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                        input_tokens.fetch_add(n, Ordering::Relaxed);
                    }
                    if let Some(n) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
                        output_tokens.fetch_add(n, Ordering::Relaxed);
                    }
                    if let Some(n) = usage
                        .get("cache_read_input_tokens")
                        .and_then(|v| v.as_u64())
                    {
                        cache_read_tokens.fetch_add(n, Ordering::Relaxed);
                    }
                }
            }

            let stored = if line.len() > MAX_PAYLOAD {
                tracing::warn!(full_size = line.len(), "event truncated (> 64 KiB)");
                db::truncate_payload(&line)
            } else {
                line
            };

            // Inject session_id so each event is tagged with the owning session.
            let (enriched, event_type) =
                if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&stored) {
                    v["session_id"] = serde_json::Value::String(session_id.to_string());
                    let etype = v
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let s = serde_json::to_string(&v).unwrap_or(stored);
                    (s, etype)
                } else {
                    (stored, "unknown".to_string())
                };

            let db_ref = db.clone();
            let enriched_for_db = enriched.clone();
            let seq = tokio::task::spawn_blocking(move || {
                let conn = db_ref.lock().unwrap();
                db::insert_event(&conn, now, &enriched_for_db)
            })
            .await
            .context("spawn_blocking panicked")??;

            // Broadcast to WebSocket clients (best-effort — ignore if no subscribers)
            let _ = events_tx.send((seq, now, enriched.clone()));

            event_count += 1;
            if event_count.is_multiple_of(100) {
                let db_ref = db.clone();
                tokio::task::spawn_blocking(move || {
                    let conn = db_ref.lock().unwrap();
                    db::enforce_retention(&conn)
                })
                .await
                .context("spawn_blocking (retention) panicked")??;
            }

            tracing::info!(seq, event_type = %event_type, "event logged");
        } // end inner block
    } // end loop

    tokio::task::spawn_blocking(move || child.wait())
        .await
        .context("spawn_blocking (child wait) panicked")?
        .context("child wait failed")?;

    tracing::info!("claude exited");
    Ok(())
}

/// Strip ANSI/VT100 escape sequences (e.g. \x1b[...m) from a string.
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' {
            match chars.peek() {
                Some('[') => {
                    chars.next();
                    // CSI sequence: consume until final byte (ASCII letter or a few other terminators)
                    for c2 in chars.by_ref() {
                        if c2.is_ascii_alphabetic() || c2 == 'm' || c2 == 'J' || c2 == 'K' {
                            break;
                        }
                    }
                }
                Some(']') => {
                    chars.next();
                    // OSC sequence: consume until BEL (\x07) or String Terminator (\x1b\\)
                    for c2 in chars.by_ref() {
                        if c2 == '\x07' {
                            break;
                        }
                        if c2 == '\x1b' {
                            chars.next(); // consume the trailing '\'
                            break;
                        }
                    }
                }
                _ => {} // lone ESC — skip it
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Write PreToolUse hook config + tool permissions to ~/.claude/settings.local.json.
/// Uses atomic tempfile + rename to avoid partial writes.
fn write_hook_settings() -> Result<()> {
    let hook_bin = std::env::current_exe()
        .context("failed to determine current exe path")?
        .with_file_name("navetted-hook");

    if !hook_bin.exists() {
        anyhow::bail!(
            "navetted-hook not found at {}; build both binaries together",
            hook_bin.display()
        );
    }

    let hook_bin_str = hook_bin
        .to_str()
        .context("hook binary path contains non-UTF-8 characters")?;

    // Pre-approve all tools so Claude doesn't prompt interactively. Permission mode
    // stays "default" (not bypassPermissions), so PreToolUse hooks still fire.
    let settings = serde_json::json!({
        "permissions": {
            "allow": [
                "Bash(*)", "Write(*)", "Read(*)", "Edit(*)", "MultiEdit(*)",
                "Glob(*)", "Grep(*)", "LS(*)", "NotebookRead(*)", "NotebookEdit(*)",
                "WebFetch(*)", "WebSearch(*)", "Task(*)", "TodoRead(*)", "TodoWrite(*)",
                "mcp__*(*)"
            ]
        },
        "hooks": {
            "PreToolUse": [{
                "matcher": ".*",
                "hooks": [{
                    "type": "command",
                    "command": hook_bin_str
                }]
            }]
        }
    });

    let home = std::env::var("HOME").context("HOME not set")?;
    let claude_config = std::path::PathBuf::from(&home).join(".claude");
    std::fs::create_dir_all(&claude_config).context("failed to create ~/.claude")?;
    let settings_path = claude_config.join("settings.local.json");

    let tmp = settings_path.with_extension("tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&settings)?)
        .context("failed to write settings tempfile")?;
    std::fs::rename(&tmp, &settings_path).context("failed to rename settings tempfile")?;

    tracing::info!("hook settings written to {}", settings_path.display());
    Ok(())
}

fn parse_mosh_connect(stdout: &str) -> Result<(u16, String)> {
    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("MOSH CONNECT ") {
            let mut parts = rest.splitn(2, ' ');
            let port: u16 = parts
                .next()
                .unwrap_or("0")
                .parse()
                .context("invalid mosh port")?;
            let key = parts.next().unwrap_or("").to_string();
            if port == 0 || key.is_empty() {
                anyhow::bail!("mosh-server returned invalid port/key");
            }
            return Ok((port, key));
        }
    }
    anyhow::bail!("mosh-server did not output MOSH CONNECT line")
}

#[allow(dead_code)]
pub fn spawn_mosh_server() -> Result<(u16, String)> {
    let out = std::process::Command::new("mosh-server")
        .args(["new", "-s", "-c", "256"])
        .output()
        .context("failed to spawn mosh-server")?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        anyhow::bail!("mosh-server exited with {}: {}", out.status, stderr.trim());
    }
    let stdout = String::from_utf8_lossy(&out.stdout);
    parse_mosh_connect(&stdout)
}

fn unix_ts() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_mosh_connect_valid() {
        let (port, key) = parse_mosh_connect("\n\nMOSH CONNECT 60001 abc123def\n").unwrap();
        assert_eq!(port, 60001);
        assert_eq!(key, "abc123def");
    }

    #[test]
    fn parse_mosh_connect_with_leading_output() {
        let stdout = "mosh-server (mosh 1.4.0)\nCopyright ...\n\nMOSH CONNECT 60042 XYZKEY99\n";
        let (port, key) = parse_mosh_connect(stdout).unwrap();
        assert_eq!(port, 60042);
        assert_eq!(key, "XYZKEY99");
    }

    #[test]
    fn parse_mosh_connect_no_line() {
        assert!(parse_mosh_connect("some random output\n").is_err());
    }

    #[test]
    fn parse_mosh_connect_empty() {
        assert!(parse_mosh_connect("").is_err());
    }

    #[test]
    fn parse_mosh_connect_empty_key() {
        assert!(parse_mosh_connect("MOSH CONNECT 60001 \n").is_err());
    }

    #[test]
    fn parse_mosh_connect_invalid_port() {
        assert!(parse_mosh_connect("MOSH CONNECT notaport key123\n").is_err());
    }

    #[test]
    fn parse_mosh_connect_zero_port() {
        assert!(parse_mosh_connect("MOSH CONNECT 0 key123\n").is_err());
    }

    #[test]
    fn strip_ansi_removes_csi() {
        assert_eq!(strip_ansi("\x1b[32mhello\x1b[0m"), "hello");
    }

    #[test]
    fn strip_ansi_removes_osc() {
        assert_eq!(strip_ansi("\x1b]0;title\x07text"), "text");
    }

    #[test]
    fn strip_ansi_passthrough_plain() {
        assert_eq!(strip_ansi("plain text"), "plain text");
    }
}
