use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use rusqlite::Connection;
use serde_json::Value;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::{accept_async, tungstenite::Message};

use crate::{Decision, PendingApprovals};
use crate::db;

/// Broadcast channel payload: (seq, unix_ts, raw_json_string)
pub type EventTx = broadcast::Sender<(i64, f64, String)>;

pub async fn serve(
    port: u16,
    token: String,
    db: Arc<Mutex<Connection>>,
    pending: PendingApprovals,
    events_tx: EventTx,
) -> Result<()> {
    let addr = format!("0.0.0.0:{port}");
    let listener = TcpListener::bind(&addr)
        .await
        .with_context(|| format!("failed to bind WebSocket on {addr}"))?;
    tracing::info!("WebSocket listening on ws://{addr}");

    loop {
        match listener.accept().await {
            Ok((stream, peer)) => {
                tracing::info!(%peer, "WS connection accepted");
                let token = token.clone();
                let db = db.clone();
                let pending = pending.clone();
                let events_rx = events_tx.subscribe();
                tokio::spawn(async move {
                    if let Err(e) = handle_ws(stream, token, db, pending, events_rx).await {
                        tracing::error!("WS connection error: {e:#}");
                    }
                });
            }
            Err(e) => tracing::error!("WS accept error: {e}"),
        }
    }
}

async fn handle_ws(
    stream: TcpStream,
    token: String,
    db: Arc<Mutex<Connection>>,
    pending: PendingApprovals,
    mut events_rx: broadcast::Receiver<(i64, f64, String)>,
) -> Result<()> {
    let ws = accept_async(stream).await.context("WS upgrade failed")?;
    let (mut sink, mut src) = ws.split();

    // ── Phase 1: Authentication ───────────────────────────────────────────────
    let client_id = match src.next().await {
        Some(Ok(Message::Text(txt))) => {
            let msg: Value = serde_json::from_str(&txt).context("invalid hello JSON")?;
            if msg.get("type").and_then(|v| v.as_str()) != Some("hello") {
                let _ = sink
                    .send(rejected("expected hello as first message"))
                    .await;
                return Ok(());
            }
            let provided = msg.get("token").and_then(|v| v.as_str()).unwrap_or("");
            if provided != token {
                let _ = sink.send(rejected("bad token")).await;
                return Ok(());
            }
            msg.get("client_id")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string()
        }
        _ => return Ok(()),
    };

    sink.send(welcome(&client_id))
        .await
        .context("failed to send welcome")?;
    tracing::info!(%client_id, "WS authenticated");

    // ── Phase 2: Attach + replay ──────────────────────────────────────────────
    // Client sends {"type":"attach","session_id":"...","since":N} (since optional)
    // or just {"since":N}, or skips attach entirely to get live-only.
    let mut since: i64 = 0;

    // Peek at the next message without consuming it for the live loop
    match src.next().await {
        Some(Ok(Message::Text(txt))) => {
            let msg: Value = serde_json::from_str(&txt).unwrap_or_default();
            // Accept since either inline in attach or as bare {"since":N}
            if let Some(s) = msg.get("since").and_then(|v| v.as_i64()) {
                since = s;
            } else if msg.get("type").and_then(|v| v.as_str()) == Some("attach") {
                // since not inline — read next message for it
                if let Some(Ok(Message::Text(since_txt))) = src.next().await {
                    let since_msg: Value = serde_json::from_str(&since_txt).unwrap_or_default();
                    since = since_msg.get("since").and_then(|v| v.as_i64()).unwrap_or(0);
                }
            }
            // If neither matches (e.g. it was an input), we can't put it back —
            // just process it below as a client message.
            else {
                handle_input(&msg, &client_id, &pending).await;
            }
        }
        Some(Ok(Message::Close(_))) | None => return Ok(()),
        _ => {}
    }

    // Replay events
    let db2 = db.clone();
    let rows = tokio::task::spawn_blocking(move || {
        let conn = db2.lock().unwrap();
        db::events_since(&conn, since)
    })
    .await
    .context("spawn_blocking panicked")?
    .context("events_since failed")?;

    let last_seq = rows.last().map(|(s, _, _)| *s).unwrap_or(since);
    for (seq, ts, json) in &rows {
        let out = event_frame(*seq, *ts, json)?;
        sink.send(Message::Text(out))
            .await
            .context("replay send failed")?;
    }
    let caught_up = serde_json::to_string(
        &serde_json::json!({"type": "caught-up", "seq": last_seq}),
    )?;
    sink.send(Message::Text(caught_up))
        .await
        .context("caught-up send failed")?;
    tracing::info!(%client_id, since, replayed = rows.len(), "replay complete");

    // ── Phase 3: Bidirectional live loop ─────────────────────────────────────
    loop {
        tokio::select! {
            // Live events from Claude → forward to client
            result = events_rx.recv() => {
                match result {
                    Ok((seq, ts, json)) => {
                        let out = event_frame(seq, ts, &json)?;
                        if sink.send(Message::Text(out)).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::warn!(%client_id, lagged = n, "WS client too slow, events dropped");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            // Messages from client → route approvals
            msg = src.next() => {
                match msg {
                    Some(Ok(Message::Text(txt))) => {
                        if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                            handle_input(&v, &client_id, &pending).await;
                        }
                    }
                    Some(Ok(Message::Ping(data))) => {
                        if sink.send(Message::Pong(data)).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    _ => {}
                }
            }
        }
    }

    tracing::info!(%client_id, "WS connection closed");
    Ok(())
}

async fn handle_input(msg: &Value, client_id: &str, pending: &PendingApprovals) {
    if msg.get("type").and_then(|v| v.as_str()) != Some("input") {
        return;
    }
    let Some(tool_use_id) = msg.get("tool_use_id").and_then(|v| v.as_str()) else {
        return;
    };
    let decision_str = msg.get("decision").and_then(|v| v.as_str()).unwrap_or("n");
    let decision = if decision_str == "y" {
        Decision::Allow
    } else {
        Decision::Deny
    };

    if let Some(tx) = pending.lock().await.remove(tool_use_id) {
        let _ = tx.send(decision);
        tracing::info!(%client_id, %tool_use_id, %decision_str, "WS approval resolved");
    } else {
        tracing::warn!(%client_id, %tool_use_id, "no pending approval for WS input");
    }
}

fn event_frame(seq: i64, ts: f64, json: &str) -> Result<String> {
    let event: Value = serde_json::from_str(json).unwrap_or(Value::Null);
    serde_json::to_string(&serde_json::json!({
        "seq": seq,
        "ts": ts,
        "event": event,
    }))
    .context("failed to serialize event frame")
}

fn welcome(client_id: &str) -> Message {
    Message::Text(
        serde_json::to_string(&serde_json::json!({
            "type": "welcome",
            "client_id": client_id,
        }))
        .unwrap(),
    )
}

fn rejected(reason: &str) -> Message {
    Message::Text(
        serde_json::to_string(&serde_json::json!({
            "type": "rejected",
            "reason": reason,
        }))
        .unwrap(),
    )
}
