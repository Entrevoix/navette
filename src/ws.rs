use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use rusqlite::Connection;
use serde_json::Value;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, mpsc};
use tokio_tungstenite::{accept_async, tungstenite::Message};

use crate::config::Config;
use crate::db;
use crate::{BufferedDecisions, Decision, KillSwitch, PendingApprovals, RunRequest};

/// Broadcast channel payload: (seq, unix_ts, raw_json_string)
pub type EventTx = broadcast::Sender<(i64, f64, String)>;

pub async fn serve(
    port: u16,
    token: String,
    db: Arc<Mutex<Connection>>,
    pending: PendingApprovals,
    buffered: BufferedDecisions,
    events_tx: EventTx,
    run_tx: mpsc::Sender<RunRequest>,
    session_running: Arc<AtomicBool>,
    kill_switch: KillSwitch,
    cfg: Arc<Config>,
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
                let buffered = buffered.clone();
                let run_tx = run_tx.clone();
                let session_running = session_running.clone();
                let kill_switch = kill_switch.clone();
                let cfg = cfg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_ws(
                        stream,
                        token,
                        db,
                        pending,
                        buffered,
                        events_rx,
                        run_tx,
                        session_running,
                        kill_switch,
                        cfg,
                    )
                    .await
                    {
                        tracing::error!("WS connection error: {e:#}");
                    }
                });
            }
            Err(e) => tracing::error!("WS accept error: {e}"),
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn handle_ws(
    stream: TcpStream,
    token: String,
    db: Arc<Mutex<Connection>>,
    pending: PendingApprovals,
    buffered: BufferedDecisions,
    mut events_rx: broadcast::Receiver<(i64, f64, String)>,
    run_tx: mpsc::Sender<RunRequest>,
    session_running: Arc<AtomicBool>,
    kill_switch: KillSwitch,
    cfg: Arc<Config>,
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

    let is_running = session_running.load(Ordering::SeqCst);
    sink.send(welcome(&client_id, is_running))
        .await
        .context("failed to send welcome")?;
    tracing::info!(%client_id, session_running = is_running, "WS authenticated");

    // ── Phase 2: Attach + replay ──────────────────────────────────────────────
    let mut since: i64 = 0;

    match src.next().await {
        Some(Ok(Message::Text(txt))) => {
            let msg: Value = serde_json::from_str(&txt).unwrap_or_default();
            if let Some(s) = msg.get("since").and_then(|v| v.as_i64()) {
                since = s;
            } else if msg.get("type").and_then(|v| v.as_str()) == Some("attach") {
                if let Some(Ok(Message::Text(since_txt))) = src.next().await {
                    let since_msg: Value = serde_json::from_str(&since_txt).unwrap_or_default();
                    since = since_msg.get("since").and_then(|v| v.as_i64()).unwrap_or(0);
                }
            } else {
                handle_input(&msg, &client_id, &pending, &buffered, &run_tx, &session_running, &kill_switch)
                    .await;
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
            msg = src.next() => {
                match msg {
                    Some(Ok(Message::Text(txt))) => {
                        if let Ok(v) = serde_json::from_str::<Value>(&txt) {
                            if v.get("type").and_then(|t| t.as_str()) == Some("get_notify_config") {
                                let reply = serde_json::to_string(&serde_json::json!({
                                    "type": "notify_config",
                                    "topic": cfg.notify.ntfy_topic,
                                    "base_url": cfg.notify.ntfy_base_url,
                                })).unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else {
                                handle_input(&v, &client_id, &pending, &buffered, &run_tx, &session_running, &kill_switch).await;
                            }
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

async fn handle_input(
    msg: &Value,
    client_id: &str,
    pending: &PendingApprovals,
    buffered: &BufferedDecisions,
    run_tx: &mpsc::Sender<RunRequest>,
    session_running: &Arc<AtomicBool>,
    kill_switch: &KillSwitch,
) {
    let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match msg_type {
        "input" => {
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
                buffered
                    .lock()
                    .await
                    .insert(tool_use_id.to_string(), decision);
                tracing::info!(%client_id, %tool_use_id, %decision_str, "decision buffered (hook not yet registered)");
            }
        }
        "run" => {
            if session_running.load(Ordering::SeqCst) {
                tracing::warn!(%client_id, "run request ignored: session already running");
                return;
            }
            let Some(prompt) = msg.get("prompt").and_then(|v| v.as_str()) else {
                tracing::warn!(%client_id, "run request missing prompt");
                return;
            };
            let container = msg
                .get("container")
                .and_then(|v| v.as_str())
                .filter(|s| !s.is_empty())
                .map(|s| s.to_string());
            let dangerously_skip_permissions = msg
                .get("dangerously_skip_permissions")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            tracing::info!(%client_id, container = ?container, dangerously_skip_permissions, "received run request");
            let req = RunRequest {
                prompt: prompt.to_string(),
                container,
                dangerously_skip_permissions,
            };
            if run_tx.try_send(req).is_err() {
                tracing::warn!(%client_id, "run_tx full or closed");
            }
        }
        "kill_session" => {
            if let Some(tx) = kill_switch.lock().await.take() {
                let _ = tx.send(());
                tracing::info!(%client_id, "kill_session: terminating running session");
            } else {
                tracing::warn!(%client_id, "kill_session: no session running");
            }
        }
        _ => {}
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

fn welcome(client_id: &str, session_running: bool) -> Message {
    Message::Text(
        serde_json::to_string(&serde_json::json!({
            "type": "welcome",
            "client_id": client_id,
            "session_running": session_running,
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
