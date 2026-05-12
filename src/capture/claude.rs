// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

//! Thin wrapper around `claude -p "<prompt>"` for one-shot capture enrichment.
//! Distinct from `crate::claude` (which spawns an interactive PTY session for
//! the main remote-control workflow). This path is fire-and-forget: send a
//! prompt, get markdown back, no streaming, no tool-use approvals.

use std::time::Duration;

use anyhow::{Context, Result};
use tokio::process::Command;
use tokio::time::timeout;

/// Hard upper bound on `claude -p` runtime. Without this, a stuck CLI hangs
/// the WS read loop indefinitely (the dispatch arm awaits inline). The shared
/// client has a 60s request timeout, but a client timeout doesn't kill the
/// daemon-side subprocess — that keeps charging tokens until it returns.
const CLAUDE_TIMEOUT: Duration = Duration::from_secs(120);

/// Invoke `claude -p <prompt>` and return the captured stdout as a String.
///
/// The CLI is expected to be on PATH. Stderr is captured for error reporting
/// but not returned on success. Non-zero exit codes propagate as errors.
pub async fn run_claude(prompt: &str) -> Result<String> {
    // kill_on_drop(true): if the calling future is dropped (e.g. WS connection
    // closed and the spawned capture task is aborted), SIGKILL the subprocess
    // instead of orphaning it. Without this, disconnected clients can leave
    // `claude -p` running for up to CLAUDE_TIMEOUT burning tokens.
    let fut = Command::new("claude")
        .arg("-p")
        .arg(prompt)
        .kill_on_drop(true)
        .output();
    let output = timeout(CLAUDE_TIMEOUT, fut)
        .await
        .with_context(|| format!("claude -p timed out after {}s", CLAUDE_TIMEOUT.as_secs()))?
        .context("failed to spawn `claude` — is the CLI on PATH?")?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        anyhow::bail!(
            "claude -p exited with status {:?}: {}",
            output.status.code(),
            stderr.trim()
        );
    }

    let stdout = String::from_utf8(output.stdout).context("claude returned non-UTF8 output")?;
    Ok(stdout)
}
