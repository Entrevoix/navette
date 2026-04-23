// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

use std::os::unix::fs::PermissionsExt;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use anyhow::{Context, Result};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::oneshot;

use crate::db;
use crate::ws::EventTx;
use crate::{BufferedDecisions, Decision, PendingApprovals};

/// What the navetted-hook binary sends over the socket.
#[derive(Deserialize)]
struct HookRequest {
    tool_use_id: String,
    tool_name: String,
    #[serde(default)]
    session_id: String,
    #[allow(dead_code)]
    input: Value,
}

/// What we write back to the hook binary.
#[derive(Serialize)]
struct HookResponse {
    decision: String,
}

/// Bind the Unix socket and accept hook connections forever.
pub async fn serve(
    pending: PendingApprovals,
    buffered: BufferedDecisions,
    events_tx: EventTx,
    db: Arc<Mutex<Connection>>,
    approval_ttl_secs: u64,
    approval_warn_before_secs: u64,
) -> Result<()> {
    let socket_dir = socket_dir()?;
    std::fs::create_dir_all(&socket_dir)
        .with_context(|| format!("failed to create socket dir {}", socket_dir.display()))?;
    std::fs::set_permissions(&socket_dir, std::fs::Permissions::from_mode(0o700))
        .context("failed to chmod socket dir")?;

    let socket_path = socket_dir.join("hook.sock");
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
                let db = db.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_connection(
                        stream,
                        pending,
                        buffered,
                        events_tx,
                        db,
                        approval_ttl_secs,
                        approval_warn_before_secs,
                    )
                    .await
                    {
                        tracing::error!("hook connection error: {e:#}");
                    }
                });
            }
            Err(e) => tracing::error!("accept error on hook socket: {e}"),
        }
    }
}

async fn handle_connection(
    mut stream: UnixStream,
    pending: PendingApprovals,
    buffered: BufferedDecisions,
    events_tx: EventTx,
    db: Arc<Mutex<Connection>>,
    approval_ttl_secs: u64,
    approval_warn_before_secs: u64,
) -> Result<()> {
    let mut buf = String::new();
    tokio::time::timeout(Duration::from_secs(5), stream.read_to_string(&mut buf))
        .await
        .context("hook request timed out after 5s")?
        .context("failed to read hook request")?;

    let req: HookRequest = serde_json::from_str(&buf).context("failed to parse hook request")?;

    tracing::info!(tool_use_id = %req.tool_use_id, tool = %req.tool_name, "approval pending");

    let decision = if let Some(d) = buffered.lock().await.remove(&req.tool_use_id) {
        tracing::info!(tool_use_id = %req.tool_use_id, "using buffered decision");
        d
    } else {
        let (tx, rx) = oneshot::channel::<Decision>();
        pending.lock().await.insert(req.tool_use_id.clone(), tx);

        let expires_at = unix_ts() + approval_ttl_secs as f64;
        persist_and_emit(
            &db,
            &events_tx,
            serde_json::json!({
                "type": "approval_pending",
                "tool_use_id": req.tool_use_id,
                "tool_name": req.tool_name,
                "session_id": req.session_id,
                "expires_at": expires_at,
            }),
        );

        // Warning task with cancellation: cancelled if user decides before the deadline.
        let warn_delay = approval_ttl_secs.saturating_sub(approval_warn_before_secs);
        let (cancel_tx, cancel_rx) = oneshot::channel::<()>();
        let db_warn = db.clone();
        let warn_tx = events_tx.clone();
        let warn_id = req.tool_use_id.clone();
        let warn_session_id = req.session_id.clone();
        tokio::spawn(async move {
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(warn_delay)) => {
                    persist_and_emit(&db_warn, &warn_tx, serde_json::json!({
                        "type": "approval_warning",
                        "tool_use_id": warn_id,
                        "session_id": warn_session_id,
                        "seconds_remaining": approval_warn_before_secs,
                    }));
                }
                _ = cancel_rx => {}
            }
        });

        match tokio::time::timeout(Duration::from_secs(approval_ttl_secs), rx).await {
            Ok(Ok(d)) => {
                let _ = cancel_tx.send(());
                d
            }
            _ => {
                pending.lock().await.remove(&req.tool_use_id);
                persist_and_emit(
                    &db,
                    &events_tx,
                    serde_json::json!({
                        "type": "approval_expired",
                        "tool_use_id": req.tool_use_id,
                        "session_id": req.session_id,
                        "auto_decision": "deny",
                    }),
                );
                tracing::info!(tool_use_id = %req.tool_use_id, "approval timed out — auto-deny");
                Decision::Deny
            }
        }
    };

    tracing::info!(tool_use_id = %req.tool_use_id, decision = ?decision, "approval resolved");

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
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR").unwrap_or_else(|_| "/tmp".to_string());
    Ok(std::path::PathBuf::from(runtime_dir).join("navetted"))
}

/// Persist an event to the DB and broadcast it with the assigned seq number.
fn persist_and_emit(db: &Arc<Mutex<Connection>>, tx: &EventTx, v: serde_json::Value) {
    let json = v.to_string();
    let ts = unix_ts();
    let seq = {
        let conn = db.lock().unwrap();
        db::insert_event(&conn, ts, &json).unwrap_or(0)
    };
    let _ = tx.send((seq, ts, json));
}

fn unix_ts() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}

#[cfg(test)]
mod tests {
    use crate::Decision;

    #[test]
    fn decision_allow_serializes_to_allow_string() {
        let d = Decision::Allow;
        let s = match &d {
            Decision::Allow => "allow",
            Decision::Deny => "deny",
        };
        assert_eq!(s, "allow");
    }

    #[test]
    fn decision_deny_serializes_to_deny_string() {
        let d = Decision::Deny;
        let s = match &d {
            Decision::Allow => "allow",
            Decision::Deny => "deny",
        };
        assert_eq!(s, "deny");
    }

    #[test]
    fn decision_equality() {
        assert_eq!(Decision::Allow, Decision::Allow);
        assert_eq!(Decision::Deny, Decision::Deny);
        assert_ne!(Decision::Allow, Decision::Deny);
    }

    #[test]
    fn decision_clone() {
        let original = Decision::Allow;
        let cloned = original.clone();
        assert_eq!(original, cloned);

        let original2 = Decision::Deny;
        let cloned2 = original2.clone();
        assert_eq!(original2, cloned2);
    }

    #[test]
    fn hook_response_json_contains_decision_field() {
        use super::HookResponse;
        let resp = HookResponse {
            decision: "allow".to_string(),
        };
        let json = serde_json::to_string(&resp).unwrap();
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(v["decision"], "allow");
    }

    #[test]
    fn hook_request_deserializes_with_defaults() {
        use super::HookRequest;
        let json = r#"{"tool_use_id":"tid-1","tool_name":"bash","input":{}}"#;
        let req: HookRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.tool_use_id, "tid-1");
        assert_eq!(req.tool_name, "bash");
        // session_id has #[serde(default)] — should be empty string
        assert_eq!(req.session_id, "");
    }

    #[test]
    fn hook_request_deserializes_with_session_id() {
        use super::HookRequest;
        let json = r#"{"tool_use_id":"tid-2","tool_name":"read_file","session_id":"sess-xyz","input":{"path":"/tmp/x"}}"#;
        let req: HookRequest = serde_json::from_str(json).unwrap();
        assert_eq!(req.tool_use_id, "tid-2");
        assert_eq!(req.session_id, "sess-xyz");
    }

    #[test]
    fn socket_dir_returns_path_under_runtime_dir() {
        use super::socket_dir;
        let dir = socket_dir().unwrap();
        // Should end with "navetted"
        assert_eq!(dir.file_name().and_then(|n| n.to_str()), Some("navetted"));
    }
}
