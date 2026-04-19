use std::io::{BufRead, BufReader};
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

use anyhow::{Context, Result};
use portable_pty::{CommandBuilder, PtySize, native_pty_system};
use rusqlite::Connection;
use tokio::sync::mpsc;

use crate::PendingApprovals;
use crate::db;
use crate::ws::EventTx;

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
    session_id: &str,
    kill_rx: oneshot::Receiver<()>,
    db: Arc<Mutex<Connection>>,
    _pending: PendingApprovals,
    events_tx: EventTx,
    input_tokens: Arc<AtomicU64>,
    output_tokens: Arc<AtomicU64>,
    cache_read_tokens: Arc<AtomicU64>,
) -> Result<()> {
    if !dangerously_skip_permissions {
        write_hook_settings().context("failed to write hook settings")?;
    }

    let env_bin = std::env::var("CLAUDE_BIN").unwrap_or_else(|_| "claude".to_string());
    let claude_bin = command.unwrap_or(&env_bin).to_string();

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
            tracing::info!(container = c, dangerously_skip_permissions, "spawning claude inside distrobox container");
            let mut cmd = CommandBuilder::new("distrobox-enter");
            let mut args = vec!["--name", c, "--", &claude_bin, "--output-format", "stream-json", "--verbose"];
            if dangerously_skip_permissions {
                args.push(SKIP_PERMISSIONS_FLAG);
            }
            args.extend(["-p", prompt]);
            cmd.args(&args);
            cmd
        }
        None => {
            tracing::info!(dangerously_skip_permissions, "spawning claude");
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
    cmd.env("CLAUDED_SESSION_ID", session_id);

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

        let stored = if line.len() > MAX_PAYLOAD {
            tracing::warn!(full_size = line.len(), "event truncated (> 64 KiB)");
            db::truncate_payload(&line)
        } else {
            line.clone()
        };

        // Inject session_id so each event is tagged with the owning session.
        let enriched = if let Ok(mut v) = serde_json::from_str::<serde_json::Value>(&stored) {
            v["session_id"] = serde_json::Value::String(session_id.to_string());
            serde_json::to_string(&v).unwrap_or(stored)
        } else {
            stored
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
        let _ = events_tx.send((seq, now, enriched));

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

        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
            let event_type = v
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("unknown");
            tracing::info!(seq, event_type, "event logged");

            // Parse usage fields from assistant events and accumulate token counts.
            if let Some(usage) = v.get("usage") {
                if let Some(n) = usage.get("input_tokens").and_then(|v| v.as_u64()) {
                    input_tokens.fetch_add(n, Ordering::Relaxed);
                }
                if let Some(n) = usage.get("output_tokens").and_then(|v| v.as_u64()) {
                    output_tokens.fetch_add(n, Ordering::Relaxed);
                }
                if let Some(n) = usage.get("cache_read_input_tokens").and_then(|v| v.as_u64()) {
                    cache_read_tokens.fetch_add(n, Ordering::Relaxed);
                }
            }
        }
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
        .with_file_name("clauded-hook");

    if !hook_bin.exists() {
        anyhow::bail!(
            "clauded-hook not found at {}; build both binaries together",
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

fn unix_ts() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}
