use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use rusqlite::Connection;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

use crate::PendingApprovals;
use crate::db;

const MAX_PAYLOAD: usize = 65_536; // 64 KiB

pub async fn spawn_and_process(
    prompt: &str,
    db: Arc<Mutex<Connection>>,
    _pending: PendingApprovals,
) -> Result<()> {
    write_hook_settings().context("failed to write hook settings")?;

    let claude_bin = std::env::var("CLAUDE_BIN").unwrap_or_else(|_| "claude".to_string());

    let mut child = Command::new(&claude_bin)
        .args([
            "--output-format",
            "stream-json",
            "--dangerously-skip-permissions",
            "--verbose",
            "-p",
            prompt,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .with_context(|| format!("failed to spawn {claude_bin}"))?;

    let stdout = child.stdout.take().context("claude stdout was not captured")?;
    let mut lines = BufReader::new(stdout).lines();
    let mut event_count: u64 = 0;

    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }

        let now = unix_ts();

        // Enforce payload cap
        let stored = if line.len() > MAX_PAYLOAD {
            tracing::warn!(full_size = line.len(), "event truncated (> 64 KiB)");
            db::truncate_payload(&line)
        } else {
            line.clone()
        };

        // Log to SQLite on a blocking thread (rusqlite is not async)
        let db_ref = db.clone();
        let seq = tokio::task::spawn_blocking(move || {
            let conn = db_ref.lock().unwrap();
            db::insert_event(&conn, now, &stored)
        })
        .await
        .context("spawn_blocking panicked")??;

        // Enforce 10k event cap every 100 inserts
        event_count += 1;
        if event_count % 100 == 0 {
            let db_ref = db.clone();
            tokio::task::spawn_blocking(move || {
                let conn = db_ref.lock().unwrap();
                db::enforce_retention(&conn)
            })
            .await
            .context("spawn_blocking (retention) panicked")??;
        }

        // Log event type for visibility
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&line) {
            let event_type = v
                .get("type")
                .and_then(|t| t.as_str())
                .unwrap_or("unknown");
            tracing::info!(seq, event_type, "event logged");
        }
    }

    let status = child.wait().await?;
    tracing::info!("claude exited with {status}");

    Ok(())
}

/// Write PreToolUse hook config to ~/.claude/settings.local.json.
/// Uses atomic tempfile + rename to avoid partial writes.
fn write_hook_settings() -> Result<()> {
    // clauded-hook lives next to clauded in the same bin directory
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

    let settings = serde_json::json!({
        "hooks": {
            "PreToolUse": [{
                "matcher": ".*",
                "command": hook_bin_str
            }]
        }
    });

    let home = std::env::var("HOME").context("HOME not set")?;
    let claude_config = std::path::PathBuf::from(&home).join(".claude");
    std::fs::create_dir_all(&claude_config).context("failed to create ~/.claude")?;
    let settings_path = claude_config.join("settings.local.json");

    // Atomic write
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
