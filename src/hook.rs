use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::oneshot;

use crate::ws::EventTx;
use crate::{BufferedDecisions, Decision, PendingApprovals};

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
pub async fn serve(
    pending: PendingApprovals,
    buffered: BufferedDecisions,
    events_tx: EventTx,
    approval_ttl_secs: u64,
    approval_warn_before_secs: u64,
) -> Result<()> {
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
                let buffered = buffered.clone();
                let events_tx = events_tx.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(
                        stream,
                        pending,
                        buffered,
                        events_tx,
                        approval_ttl_secs,
                        approval_warn_before_secs,
                    )
                    .await
                    {
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

async fn handle_connection(
    mut stream: UnixStream,
    pending: PendingApprovals,
    buffered: BufferedDecisions,
    events_tx: EventTx,
    approval_ttl_secs: u64,
    approval_warn_before_secs: u64,
) -> Result<()> {
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

    // If the WS client already sent a decision before the hook registered, use it.
    let decision = if let Some(d) = buffered.lock().await.remove(&req.tool_use_id) {
        tracing::info!(tool_use_id = %req.tool_use_id, "using buffered decision");
        d
    } else {
        // Register a oneshot channel keyed by tool_use_id.
        let (tx, rx) = oneshot::channel::<Decision>();
        pending.lock().await.insert(req.tool_use_id.clone(), tx);

        let expires_at = unix_ts() + approval_ttl_secs as f64;
        emit_event(&events_tx, serde_json::json!({
            "type": "approval_pending",
            "tool_use_id": req.tool_use_id,
            "tool_name": req.tool_name,
            "expires_at": expires_at,
        }));

        // Warning task fires warn_before_secs before the deadline.
        // May fire even if approval was already resolved — mobile client ignores stale ids.
        let warn_tx = events_tx.clone();
        let warn_id = req.tool_use_id.clone();
        let warn_delay = approval_ttl_secs.saturating_sub(approval_warn_before_secs);
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(warn_delay)).await;
            emit_event(&warn_tx, serde_json::json!({
                "type": "approval_warning",
                "tool_use_id": warn_id,
                "seconds_remaining": approval_warn_before_secs,
            }));
        });

        match tokio::time::timeout(Duration::from_secs(approval_ttl_secs), rx).await {
            Ok(Ok(d)) => d,
            _ => {
                pending.lock().await.remove(&req.tool_use_id);
                emit_event(&events_tx, serde_json::json!({
                    "type": "approval_expired",
                    "tool_use_id": req.tool_use_id,
                    "auto_decision": "deny",
                }));
                tracing::info!(tool_use_id = %req.tool_use_id, "approval timed out — auto-deny");
                Decision::Deny
            }
        }
    };

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

fn emit_event(tx: &EventTx, v: serde_json::Value) {
    let _ = tx.send((0, unix_ts(), v.to_string()));
}

fn unix_ts() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}
