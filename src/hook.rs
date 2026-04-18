use std::os::unix::fs::PermissionsExt;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::oneshot;

use crate::{Decision, PendingApprovals};

/// What the clauded-hook binary sends over the socket.
#[derive(Deserialize)]
struct HookRequest {
    tool_use_id: String,
    tool_name: String,
    #[allow(dead_code)]
    input: Value,
}

/// What we write back to the hook binary.
#[derive(Serialize)]
struct HookResponse {
    decision: String,
}

/// Bind the Unix socket and accept hook connections forever.
/// Each connection is handled in its own spawned task.
pub async fn serve(pending: PendingApprovals) -> Result<()> {
    let socket_dir = socket_dir()?;
    std::fs::create_dir_all(&socket_dir)
        .with_context(|| format!("failed to create socket dir {}", socket_dir.display()))?;
    // chmod 700 — only daemon and child processes may connect
    std::fs::set_permissions(&socket_dir, std::fs::Permissions::from_mode(0o700))
        .context("failed to chmod socket dir")?;

    let socket_path = socket_dir.join("hook.sock");
    // Remove stale socket from a previous run
    let _ = std::fs::remove_file(&socket_path);

    let listener = UnixListener::bind(&socket_path)
        .with_context(|| format!("failed to bind {}", socket_path.display()))?;
    tracing::info!("hook socket at {}", socket_path.display());

    loop {
        match listener.accept().await {
            Ok((stream, _)) => {
                let pending = pending.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(stream, pending).await {
                        tracing::error!("hook connection error: {e:#}");
                    }
                });
            }
            Err(e) => {
                tracing::error!("accept error on hook socket: {e}");
            }
        }
    }
}

async fn handle_connection(mut stream: UnixStream, pending: PendingApprovals) -> Result<()> {
    // Read request JSON until hook binary shuts down its write half
    let mut buf = String::new();
    stream
        .read_to_string(&mut buf)
        .await
        .context("failed to read hook request")?;

    let req: HookRequest =
        serde_json::from_str(&buf).context("failed to parse hook request")?;

    tracing::info!(
        tool_use_id = %req.tool_use_id,
        tool = %req.tool_name,
        "approval pending"
    );

    // Register a oneshot channel keyed by tool_use_id.
    // Concurrent tool calls each get their own independent slot.
    let (tx, rx) = oneshot::channel::<Decision>();
    pending.lock().await.insert(req.tool_use_id.clone(), tx);

    // Block until a client (stdin or future WebSocket) sends a decision.
    // If the sender is dropped (daemon shutdown), deny.
    let decision = rx.await.unwrap_or(Decision::Deny);

    pending.lock().await.remove(&req.tool_use_id);

    tracing::info!(
        tool_use_id = %req.tool_use_id,
        decision = ?decision,
        "approval resolved"
    );

    let response = HookResponse {
        decision: match &decision {
            Decision::Allow => "allow".to_string(),
            Decision::Deny => "deny".to_string(),
        },
    };
    let response_bytes = serde_json::to_vec(&response).context("failed to serialize response")?;
    stream
        .write_all(&response_bytes)
        .await
        .context("failed to write hook response")?;

    Ok(())
}

pub fn socket_dir() -> Result<std::path::PathBuf> {
    let runtime_dir =
        std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    Ok(std::path::PathBuf::from(runtime_dir).join("clauded"))
}
