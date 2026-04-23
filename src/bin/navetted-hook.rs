// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

/// PreToolUse hook binary for navetted.
///
/// Claude Code calls this as a subprocess before every tool execution.
/// We connect to the daemon's Unix socket, forward the tool call, block
/// until the user approves or denies, then exit:
///   exit 0 → allow
///   exit 2 → deny (also used for every error path — never fail open)
///
/// Protocol:
///   stdin  → full Claude hook JSON (includes tool_use_id, tool_name, tool_input)
///   socket → send HookRequest JSON, then EOF (shutdown write half)
///   socket → read DaemonResponse JSON until daemon closes connection
use std::process;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::time::{timeout, Duration};

/// What Claude Code sends to the hook on stdin.
#[derive(Deserialize)]
struct HookInput {
    tool_use_id: String,
    tool_name: String,
    tool_input: Value,
}

/// What we send to the daemon over the Unix socket.
#[derive(Serialize)]
struct HookRequest {
    tool_use_id: String,
    tool_name: String,
    session_id: String,
    input: Value,
}

/// What the daemon sends back.
#[derive(Deserialize)]
struct DaemonResponse {
    decision: String, // "allow" | "deny"
}

fn main() {
    // Read stdin synchronously before starting the async runtime.
    // stdin is complete before Claude Code invokes us, so this is fine.
    let stdin_buf = read_stdin();

    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap_or_else(|e| {
            eprintln!("navetted-hook: failed to build runtime: {e}");
            process::exit(2);
        });

    let exit_code = rt.block_on(run(stdin_buf)).unwrap_or_else(|e| {
        eprintln!("navetted-hook: {e:#}");
        2
    });

    process::exit(exit_code);
}

fn read_stdin() -> String {
    use std::io::Read;
    let mut buf = String::new();
    std::io::stdin()
        .lock()
        .read_to_string(&mut buf)
        .unwrap_or_else(|e| {
            eprintln!("navetted-hook: failed to read stdin: {e}");
            process::exit(2);
        });
    buf
}

async fn run(stdin_buf: String) -> Result<i32> {
    let hook_input: HookInput =
        serde_json::from_str(&stdin_buf).context("failed to parse hook input from stdin")?;

    let socket_path = socket_path();

    // 500ms connect timeout — if the daemon isn't up, deny immediately.
    let mut stream = timeout(
        Duration::from_millis(500),
        UnixStream::connect(&socket_path),
    )
    .await
    .context("connect timeout (500ms) — is navetted running?")?
    .with_context(|| format!("failed to connect to {socket_path}"))?;

    // Send request JSON followed by EOF so the daemon knows we're done writing.
    let session_id = std::env::var("NAVETTED_SESSION_ID").unwrap_or_default();
    let request = HookRequest {
        tool_use_id: hook_input.tool_use_id,
        tool_name: hook_input.tool_name,
        session_id,
        input: hook_input.tool_input,
    };
    let request_bytes = serde_json::to_vec(&request).context("failed to serialize request")?;
    stream
        .write_all(&request_bytes)
        .await
        .context("failed to write request to socket")?;
    stream
        .shutdown()
        .await
        .context("failed to shut down write half")?;

    // Block until the daemon writes a response and closes its write half.
    // No timeout here — the user may take a while to approve on their phone.
    let mut response_buf = String::new();
    stream
        .read_to_string(&mut response_buf)
        .await
        .context("failed to read response from socket")?;

    let response: DaemonResponse =
        serde_json::from_str(&response_buf).context("failed to parse daemon response")?;

    match response.decision.as_str() {
        "allow" => Ok(0),
        "deny" => Ok(2),
        other => {
            eprintln!("navetted-hook: unknown decision '{other}', denying");
            Ok(2)
        }
    }
}

fn socket_path() -> String {
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    format!("{runtime_dir}/navetted/hook.sock")
}
