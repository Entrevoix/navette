use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

use anyhow::{Context, Result};
use subtle::ConstantTimeEq;
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use rusqlite::Connection;
use serde_json::Value;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, oneshot};
use tokio_tungstenite::{accept_async, tungstenite::Message};

use crate::config::Config;
use crate::db;
use crate::{BufferedDecisions, Decision, PendingApprovals, Sessions};

/// Broadcast channel payload: (seq, unix_ts, raw_json_string)
pub type EventTx = broadcast::Sender<(i64, f64, String)>;

#[allow(clippy::too_many_arguments)]
pub async fn serve(
    port: u16,
    token: String,
    db: Arc<Mutex<Connection>>,
    pending: PendingApprovals,
    buffered: BufferedDecisions,
    events_tx: EventTx,
    sessions: Sessions,
    max_concurrent: usize,
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
                let sessions = sessions.clone();
                let events_tx = events_tx.clone();
                let cfg = cfg.clone();
                tokio::spawn(async move {
                    if let Err(e) = handle_ws(
                        stream,
                        token,
                        db,
                        pending,
                        buffered,
                        events_rx,
                        events_tx,
                        sessions,
                        max_concurrent,
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
    events_tx: EventTx,
    sessions: Sessions,
    max_concurrent: usize,
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
            if !constant_time_token_eq(provided, &token) {
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

    let head_seq = {
        let conn = db.lock().unwrap();
        db::head_seq(&conn).unwrap_or(0)
    };
    let sessions_list = crate::sessions_snapshot(&sessions).await;
    sink.send(welcome(&client_id, head_seq, &sessions_list))
        .await
        .context("failed to send welcome")?;
    tracing::info!(%client_id, "WS authenticated");

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
                handle_input(&msg, &client_id, &pending, &buffered).await;
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
                            let msg_type = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
                            if msg_type == "run" {
                                let session_count = sessions.lock().await.len();
                                if session_count >= max_concurrent {
                                    let reply = serde_json::to_string(
                                        &serde_json::json!({"type": "session_busy", "max": max_concurrent})
                                    ).unwrap_or_default();
                                    if sink.send(Message::Text(reply)).await.is_err() {
                                        break;
                                    }
                                } else if let Some(prompt) = v.get("prompt").and_then(|p| p.as_str()) {
                                    let container = v
                                        .get("container")
                                        .and_then(|v| v.as_str())
                                        .filter(|s| !s.is_empty())
                                        .map(|s| s.to_string());
                                    let dangerously_skip_permissions = v
                                        .get("dangerously_skip_permissions")
                                        .and_then(|v| v.as_bool())
                                        .unwrap_or(false);
                                    let work_dir = v
                                        .get("work_dir")
                                        .and_then(|v| v.as_str())
                                        .filter(|s| !s.is_empty())
                                        .map(|s| s.to_string());
                                    let command = v
                                        .get("command")
                                        .and_then(|v| v.as_str())
                                        .filter(|s| !s.is_empty())
                                        .map(|s| s.to_string());

                                    let session_id = new_session_id();
                                    let (kill_tx, kill_rx) = oneshot::channel::<()>();

                                    sessions.lock().await.insert(session_id.clone(), crate::SessionEntry {
                                        prompt: prompt.to_string(),
                                        container: container.clone(),
                                        command: command.clone(),
                                        started_at: unix_ts(),
                                        kill_tx: Some(kill_tx),
                                        input_tokens: Arc::new(AtomicU64::new(0)),
                                        output_tokens: Arc::new(AtomicU64::new(0)),
                                        cache_read_tokens: Arc::new(AtomicU64::new(0)),
                                    });
                                    crate::emit_session_list_changed(&sessions, &events_tx).await;

                                    let req = crate::RunRequest {
                                        prompt: prompt.to_string(),
                                        container,
                                        dangerously_skip_permissions,
                                        work_dir,
                                        command,
                                    };
                                    tokio::spawn(crate::run_session(
                                        session_id.clone(),
                                        req,
                                        sessions.clone(),
                                        db.clone(),
                                        pending.clone(),
                                        events_tx.clone(),
                                        kill_rx,
                                    ));
                                    tracing::info!(%client_id, %session_id, "spawned session");

                                    let reply = serde_json::to_string(
                                        &serde_json::json!({"type": "run_accepted", "session_id": session_id})
                                    ).unwrap_or_default();
                                    if sink.send(Message::Text(reply)).await.is_err() {
                                        break;
                                    }
                                }
                            } else if msg_type == "kill_session" {
                                let session_id = v.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
                                if let Some(entry) = sessions.lock().await.get_mut(session_id) {
                                    if let Some(tx) = entry.kill_tx.take() {
                                        let _ = tx.send(());
                                        tracing::info!(%client_id, %session_id, "kill_session: terminating");
                                    }
                                } else {
                                    tracing::warn!(%client_id, %session_id, "kill_session: session not found");
                                }
                            } else if msg_type == "list_sessions" {
                                let list = crate::sessions_snapshot(&sessions).await;
                                let reply = serde_json::to_string(
                                    &serde_json::json!({"type": "sessions_list", "sessions": list})
                                ).unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "get_token_usage" {
                                let session_id = v.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
                                let reply = if let Some(entry) = sessions.lock().await.get(session_id) {
                                    serde_json::to_string(&serde_json::json!({
                                        "type": "token_usage",
                                        "session_id": session_id,
                                        "input_tokens": entry.input_tokens.load(Ordering::Relaxed),
                                        "output_tokens": entry.output_tokens.load(Ordering::Relaxed),
                                        "cache_read_tokens": entry.cache_read_tokens.load(Ordering::Relaxed),
                                    })).unwrap_or_default()
                                } else {
                                    serde_json::to_string(&serde_json::json!({
                                        "type": "token_usage",
                                        "session_id": session_id,
                                        "input_tokens": 0,
                                        "output_tokens": 0,
                                        "cache_read_tokens": 0,
                                    })).unwrap_or_default()
                                };
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "get_notify_config" {
                                let reply = serde_json::to_string(&serde_json::json!({
                                    "type": "notify_config",
                                    "topic": cfg.notify.ntfy_topic,
                                    "base_url": cfg.notify.ntfy_base_url,
                                })).unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "send_test_notification" {
                                let notify_cfg = cfg.notify.clone();
                                let result = crate::notify::NotifyClient::new(&notify_cfg)
                                    .publish("clauded test", "Mobile onboarding test", "default", &["bell"])
                                    .await;
                                let reply = match result {
                                    Ok(()) => serde_json::to_string(&serde_json::json!({
                                        "type": "test_notification_sent",
                                        "ok": true,
                                    })).unwrap_or_default(),
                                    Err(e) => serde_json::to_string(&serde_json::json!({
                                        "type": "test_notification_sent",
                                        "ok": false,
                                        "error": e.to_string(),
                                    })).unwrap_or_default(),
                                };
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "list_skills" {
                                let home = std::env::var("HOME").unwrap_or_default();
                                let skills_dir = std::path::PathBuf::from(&home).join(".claude/skills");
                                let mut skills = Vec::new();
                                if let Ok(entries) = std::fs::read_dir(&skills_dir) {
                                    for entry in entries.flatten() {
                                        if entry.path().is_dir() {
                                            let skill_name = entry.file_name().to_string_lossy().to_string();
                                            let skill_md = entry.path().join("SKILL.md");
                                            let description = std::fs::read_to_string(&skill_md)
                                                .ok()
                                                .and_then(|s| {
                                                    s.lines()
                                                        .find(|l| !l.starts_with('#') && !l.trim().is_empty() && !l.starts_with("---"))
                                                        .map(|l| l.trim().to_string())
                                                })
                                                .unwrap_or_default();
                                            skills.push(serde_json::json!({
                                                "name": skill_name,
                                                "description": description,
                                            }));
                                        }
                                    }
                                }
                                skills.sort_by(|a, b| {
                                    a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
                                });
                                let response = serde_json::json!({ "type": "skills_list", "skills": skills });
                                if let Ok(s) = serde_json::to_string(&response) {
                                    if sink.send(Message::Text(s)).await.is_err() {
                                        break;
                                    }
                                }
                            } else if msg_type == "list_past_sessions" {
                                let db2 = db.clone();
                                let sessions_data = tokio::task::spawn_blocking(move || {
                                    let conn = db2.lock().unwrap();
                                    db::get_session_list(&conn)
                                })
                                .await
                                .context("spawn_blocking panicked")?
                                .unwrap_or_default();
                                let reply = serde_json::to_string(
                                    &serde_json::json!({"type": "past_sessions_list", "sessions": sessions_data})
                                ).unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "get_session_history" {
                                let session_id = v.get("session_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let db2 = db.clone();
                                let events_data = tokio::task::spawn_blocking(move || {
                                    let conn = db2.lock().unwrap();
                                    db::get_session_events(&conn, &session_id)
                                })
                                .await
                                .context("spawn_blocking panicked")?
                                .unwrap_or_default();
                                let sid = v.get("session_id").and_then(|v| v.as_str()).unwrap_or("");
                                let reply = serde_json::to_string(
                                    &serde_json::json!({"type": "session_history", "session_id": sid, "events": events_data})
                                ).unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "list_dir" {
                                let raw_path = v.get("path").and_then(|p| p.as_str()).unwrap_or("~");
                                let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
                                let expanded = if raw_path == "~" || raw_path.starts_with("~/") {
                                    raw_path.replacen('~', &home, 1)
                                } else {
                                    raw_path.to_string()
                                };
                                let canonical = std::fs::canonicalize(&expanded)
                                    .unwrap_or_else(|_| std::path::PathBuf::from(&expanded));

                                let response = if !canonical.starts_with(&home) {
                                    serde_json::json!({
                                        "type": "dir_listing",
                                        "path": canonical.to_string_lossy(),
                                        "entries": [],
                                        "error": "path is outside home directory"
                                    })
                                } else {
                                    match std::fs::read_dir(&canonical) {
                                        Ok(rd) => {
                                            let mut entries: Vec<serde_json::Value> = rd
                                                .filter_map(|e| e.ok())
                                                .filter(|e| !e.file_name().to_string_lossy().starts_with('.'))
                                                .map(|e| {
                                                    let is_dir = e.file_type().map(|t| t.is_dir()).unwrap_or(false);
                                                    serde_json::json!({
                                                        "name": e.file_name().to_string_lossy(),
                                                        "is_dir": is_dir
                                                    })
                                                })
                                                .collect();
                                            entries.sort_by(|a, b| {
                                                let ad = a["is_dir"].as_bool().unwrap_or(false);
                                                let bd = b["is_dir"].as_bool().unwrap_or(false);
                                                bd.cmp(&ad).then_with(|| {
                                                    a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or(""))
                                                })
                                            });
                                            entries.truncate(200);
                                            serde_json::json!({
                                                "type": "dir_listing",
                                                "path": canonical.to_string_lossy(),
                                                "entries": entries
                                            })
                                        }
                                        Err(e) => serde_json::json!({
                                            "type": "dir_listing",
                                            "path": canonical.to_string_lossy(),
                                            "entries": [],
                                            "error": e.to_string()
                                        }),
                                    }
                                };
                                tracing::debug!(%client_id, path = %canonical.display(), "list_dir");
                                if let Ok(s) = serde_json::to_string(&response) {
                                    if sink.send(Message::Text(s)).await.is_err() {
                                        break;
                                    }
                                }
                            } else if msg_type == "schedule_session" {
                                if let Some(prompt) = v.get("prompt").and_then(|p| p.as_str()) {
                                    let scheduled_at = v
                                        .get("scheduled_at")
                                        .and_then(|v| v.as_f64())
                                        .unwrap_or_else(unix_ts);
                                    let container = v
                                        .get("container")
                                        .and_then(|v| v.as_str())
                                        .filter(|s| !s.is_empty())
                                        .map(|s| s.to_string());
                                    let command = v
                                        .get("command")
                                        .and_then(|v| v.as_str())
                                        .filter(|s| !s.is_empty())
                                        .map(|s| s.to_string());
                                    let sched_id = new_session_id();
                                    let now = unix_ts();
                                    {
                                        let conn = db.lock().unwrap();
                                        let _ = db::insert_scheduled_session(
                                            &conn,
                                            &sched_id,
                                            prompt,
                                            container.as_deref(),
                                            command.as_deref(),
                                            scheduled_at,
                                            now,
                                        );
                                    }
                                    tracing::info!(%client_id, %sched_id, scheduled_at, "session scheduled");
                                    let reply = serde_json::to_string(&serde_json::json!({
                                        "type": "session_scheduled",
                                        "id": sched_id,
                                        "scheduled_at": scheduled_at,
                                    }))
                                    .unwrap_or_default();
                                    if sink.send(Message::Text(reply)).await.is_err() {
                                        break;
                                    }
                                }
                            } else if msg_type == "list_scheduled_sessions" {
                                let db2 = db.clone();
                                let scheduled = tokio::task::spawn_blocking(move || {
                                    let conn = db2.lock().unwrap();
                                    db::list_scheduled_sessions(&conn)
                                })
                                .await
                                .context("spawn_blocking panicked")?
                                .unwrap_or_default();
                                let reply = serde_json::to_string(&serde_json::json!({
                                    "type": "scheduled_sessions_list",
                                    "sessions": scheduled,
                                }))
                                .unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "cancel_scheduled_session" {
                                let sched_id = v
                                    .get("id")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                {
                                    let conn = db.lock().unwrap();
                                    let _ = db::delete_scheduled_session(&conn, &sched_id);
                                }
                                tracing::info!(%client_id, %sched_id, "scheduled session cancelled");
                                let reply = serde_json::to_string(&serde_json::json!({
                                    "type": "scheduled_session_cancelled",
                                    "id": sched_id,
                                }))
                                .unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else {
                                handle_input(&v, &client_id, &pending, &buffered).await;
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
) {
    let msg_type = msg.get("type").and_then(|v| v.as_str()).unwrap_or("");

    if msg_type == "input" {
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
}

/// Compare two token strings in constant time to prevent timing attacks.
fn constant_time_token_eq(a: &str, b: &str) -> bool {
    a.as_bytes().ct_eq(b.as_bytes()).into()
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

fn welcome(client_id: &str, head_seq: i64, sessions: &[serde_json::Value]) -> Message {
    Message::Text(
        serde_json::to_string(&serde_json::json!({
            "type": "welcome",
            "client_id": client_id,
            "sessions": sessions,
            "head_seq": head_seq,
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

fn new_session_id() -> String {
    rand::thread_rng()
        .sample_iter(&rand::distributions::Alphanumeric)
        .take(16)
        .map(char::from)
        .collect()
}

fn unix_ts() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}
