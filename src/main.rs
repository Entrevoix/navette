mod claude;
mod config;
mod db;
mod hook;
mod notify;
mod ws;

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use anyhow::Result;
use rusqlite::Connection;
use tokio::sync::{broadcast, oneshot, Mutex};
use tokio::time::Duration;

/// Shared map: tool_use_id → oneshot sender waiting for a user decision.
pub type PendingApprovals = Arc<Mutex<HashMap<String, oneshot::Sender<Decision>>>>;

/// Decisions that arrived from a WS client before the hook registered its slot.
pub type BufferedDecisions = Arc<Mutex<HashMap<String, Decision>>>;

/// Registry of currently running sessions.
pub type Sessions = Arc<Mutex<HashMap<String, SessionEntry>>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Decision {
    Allow,
    Deny,
}

/// One running claude session.
pub struct SessionEntry {
    pub prompt: String,
    pub container: Option<String>,
    pub command: Option<String>,
    pub started_at: f64,
    /// Fires to kill the session; taken by the kill handler.
    pub kill_tx: Option<oneshot::Sender<()>>,
    /// Cumulative token counts updated atomically as events stream in.
    pub input_tokens: Arc<AtomicU64>,
    pub output_tokens: Arc<AtomicU64>,
    pub cache_read_tokens: Arc<AtomicU64>,
}

/// Sent from a WS client to start a claude session.
pub struct RunRequest {
    pub prompt: String,
    pub container: Option<String>,
    pub dangerously_skip_permissions: bool,
    pub work_dir: Option<String>,
    pub command: Option<String>,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    let cfg = Arc::new(config::load_or_create()?);
    tracing::info!(ws_port = cfg.ws_port, max_concurrent = cfg.max_concurrent_sessions, "config loaded");

    let db = Arc::new(std::sync::Mutex::new(db::open()?));
    let pending: PendingApprovals = Arc::new(Mutex::new(HashMap::new()));
    let buffered: BufferedDecisions = Arc::new(Mutex::new(HashMap::new()));
    let sessions: Sessions = Arc::new(Mutex::new(HashMap::new()));

    // Broadcast channel: (seq, unix_ts, raw_json) — 4096 slot buffer per subscriber
    let (events_tx, _) = broadcast::channel::<(i64, f64, String)>(4096);

    // Hook socket — must be running before Claude is spawned
    tokio::spawn(hook::serve(
        pending.clone(),
        buffered.clone(),
        events_tx.clone(),
        db.clone(),
        cfg.approval_ttl_secs,
        cfg.approval_warn_before_secs,
    ));

    // Push notifications — subscribes to the broadcast channel and fires ntfy POSTs
    {
        let notify = notify::NotifyClient::new(&cfg.notify);
        let mut notify_rx = events_tx.subscribe();
        tokio::spawn(async move {
            while let Ok((_, _, json)) = notify_rx.recv().await {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                    match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
                        "approval_pending" => {
                            let tool = v["tool_name"].as_str().unwrap_or("tool");
                            let _ = notify.publish("Claude needs approval", tool, "default", &["warning"]).await;
                            let _ = notify.send_telegram(&format!("⚠️ Claude needs approval: {tool}")).await;
                        }
                        "approval_warning" => {
                            let secs = v["seconds_remaining"].as_u64().unwrap_or(30);
                            let body = format!("Expires in {secs}s");
                            let _ = notify.publish("Approval expiring", &body, "high", &["stopwatch"]).await;
                            let _ = notify.send_telegram(&format!("⏱️ Approval expiring in {secs}s")).await;
                        }
                        "approval_expired" => {
                            let _ = notify.publish("Auto-denied", "Approval timed out", "default", &[]).await;
                            let _ = notify.send_telegram("❌ Approval timed out and was auto-denied").await;
                        }
                        "session_ended" => {
                            let ok = v["ok"].as_bool().unwrap_or(false);
                            let (title, tag, emoji) = if ok {
                                ("Session done", "white_check_mark", "✓")
                            } else {
                                ("Session failed", "x", "✗")
                            };
                            let _ = notify.publish(title, "", "low", &[tag]).await;
                            let _ = notify.send_telegram(&format!("{emoji} Session {title}")).await;
                        }
                        _ => {}
                    }
                }
            }
        });
    }

    // Scheduler: poll every 30 s and fire sessions whose time has arrived.
    {
        let scheduler_db = db.clone();
        let scheduler_sessions = sessions.clone();
        let scheduler_events_tx = events_tx.clone();
        let scheduler_pending = pending.clone();
        let scheduler_cfg = cfg.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(30)).await;
                let now = unix_ts();
                let pending_jobs = {
                    let conn = scheduler_db.lock().unwrap();
                    db::get_pending_scheduled_sessions(&conn).unwrap_or_default()
                };
                for job in pending_jobs {
                    let scheduled_at = job["scheduled_at"].as_f64().unwrap_or(0.0);
                    if scheduled_at > now {
                        continue;
                    }
                    let id = job["id"].as_str().unwrap_or("").to_string();
                    let prompt = job["prompt"].as_str().unwrap_or("").to_string();
                    let container = job["container"].as_str().map(|s| s.to_string());
                    let command = job["command"].as_str().map(|s| s.to_string());

                    // Mark fired before spawning so a crash doesn't re-fire.
                    {
                        let conn = scheduler_db.lock().unwrap();
                        let _ = db::mark_scheduled_session_fired(&conn, &id);
                    }

                    // Enforce concurrency limit.
                    let session_count = scheduler_sessions.lock().await.len();
                    if session_count >= scheduler_cfg.max_concurrent_sessions {
                        tracing::warn!(scheduled_id = %id, "scheduler: max concurrent sessions reached, skipping job");
                        continue;
                    }

                    // Emit a notification event.
                    let fired_json = serde_json::to_string(&serde_json::json!({
                        "type": "scheduled_session_fired",
                        "scheduled_id": id,
                        "prompt": prompt,
                    }))
                    .unwrap_or_default();
                    let _ = scheduler_events_tx.send((0, now, fired_json));

                    // Spawn the session.
                    let session_id = {
                        use rand::Rng;
                        rand::thread_rng()
                            .sample_iter(&rand::distributions::Alphanumeric)
                            .take(16)
                            .map(char::from)
                            .collect::<String>()
                    };
                    let (kill_tx, kill_rx) = oneshot::channel::<()>();
                    scheduler_sessions.lock().await.insert(
                        session_id.clone(),
                        SessionEntry {
                            prompt: prompt.clone(),
                            container: container.clone(),
                            command: command.clone(),
                            started_at: now,
                            kill_tx: Some(kill_tx),
                            input_tokens: Arc::new(std::sync::atomic::AtomicU64::new(0)),
                            output_tokens: Arc::new(std::sync::atomic::AtomicU64::new(0)),
                            cache_read_tokens: Arc::new(std::sync::atomic::AtomicU64::new(0)),
                        },
                    );
                    emit_session_list_changed(&scheduler_sessions, &scheduler_events_tx).await;

                    let req = RunRequest {
                        prompt,
                        container,
                        dangerously_skip_permissions: false,
                        work_dir: None,
                        command,
                    };
                    tracing::info!(scheduled_id = %id, %session_id, "scheduler: firing session");
                    tokio::spawn(run_session(
                        session_id,
                        req,
                        scheduler_sessions.clone(),
                        scheduler_db.clone(),
                        scheduler_pending.clone(),
                        scheduler_events_tx.clone(),
                        kill_rx,
                    ));
                }
            }
        });
    }

    // WebSocket server
    tokio::spawn(ws::serve(
        cfg.ws_port,
        cfg.token.clone(),
        db.clone(),
        pending.clone(),
        buffered.clone(),
        events_tx.clone(),
        sessions.clone(),
        cfg.max_concurrent_sessions,
        cfg.clone(),
    ));

    // Stdin fallback approvals (useful for debugging without a WS client)
    tokio::spawn(read_stdin_approvals(pending.clone()));

    tracing::info!("clauded ready — waiting for run requests");

    // Keep the process alive; all work is driven by spawned tasks.
    std::future::pending::<()>().await;
    Ok(())
}

/// Lifecycle for a single claude session. Spawned by the WS handler.
pub async fn run_session(
    session_id: String,
    req: RunRequest,
    sessions: Sessions,
    db: Arc<std::sync::Mutex<Connection>>,
    pending: PendingApprovals,
    events_tx: ws::EventTx,
    kill_rx: oneshot::Receiver<()>,
) {
    let ts = unix_ts();
    let started_json = serde_json::to_string(&serde_json::json!({
        "type": "session_started",
        "session_id": &session_id,
        "prompt": &req.prompt,
        "container": req.container,
        "dangerously_skip_permissions": req.dangerously_skip_permissions,
        "command": req.command,
    }))
    .unwrap_or_default();
    let seq = {
        let conn = db.lock().unwrap();
        db::insert_event(&conn, ts, &started_json).unwrap_or(0)
    };
    let _ = events_tx.send((seq, ts, started_json));

    // Retrieve the token counters that were inserted into the sessions map by the WS handler.
    let (input_tokens, output_tokens, cache_read_tokens) = {
        let map = sessions.lock().await;
        match map.get(&session_id) {
            Some(e) => (e.input_tokens.clone(), e.output_tokens.clone(), e.cache_read_tokens.clone()),
            None => (
                Arc::new(AtomicU64::new(0)),
                Arc::new(AtomicU64::new(0)),
                Arc::new(AtomicU64::new(0)),
            ),
        }
    };

    let result = claude::spawn_and_process(
        &req.prompt,
        req.container.as_deref(),
        req.dangerously_skip_permissions,
        req.work_dir.as_deref(),
        req.command.as_deref(),
        &session_id,
        kill_rx,
        db.clone(),
        pending,
        events_tx.clone(),
        input_tokens,
        output_tokens,
        cache_read_tokens,
    )
    .await;

    sessions.lock().await.remove(&session_id);

    // Broadcast updated session list after removal.
    emit_session_list_changed(&sessions, &events_tx).await;

    if let Err(e) = &result {
        tracing::error!(session_id = %session_id, "session error: {e:#}");
    }

    let ts = unix_ts();
    let ended_json = serde_json::to_string(&serde_json::json!({
        "type": "session_ended",
        "session_id": &session_id,
        "ok": result.is_ok(),
    }))
    .unwrap_or_default();
    let seq = {
        let conn = db.lock().unwrap();
        db::insert_event(&conn, ts, &ended_json).unwrap_or(0)
    };
    let _ = events_tx.send((seq, ts, ended_json));
}

/// Broadcast a synthetic session_list_changed event (seq=0, not stored to DB).
pub async fn emit_session_list_changed(sessions: &Sessions, events_tx: &ws::EventTx) {
    let list = sessions_snapshot(sessions).await;
    let json = serde_json::to_string(&serde_json::json!({
        "type": "session_list_changed",
        "sessions": list,
    }))
    .unwrap_or_default();
    let _ = events_tx.send((0, unix_ts(), json));
}

/// Snapshot the sessions map as a JSON-serialisable vec.
pub async fn sessions_snapshot(sessions: &Sessions) -> Vec<serde_json::Value> {
    sessions
        .lock()
        .await
        .iter()
        .map(|(id, e)| {
            serde_json::json!({
                "session_id": id,
                "prompt": e.prompt,
                "container": e.container,
                "command": e.command,
                "started_at": e.started_at,
                "input_tokens": e.input_tokens.load(Ordering::Relaxed),
                "output_tokens": e.output_tokens.load(Ordering::Relaxed),
                "cache_read_tokens": e.cache_read_tokens.load(Ordering::Relaxed),
            })
        })
        .collect()
}

/// Fallback: type "y <tool_use_id>" or "n <tool_use_id>" directly in the terminal.
async fn read_stdin_approvals(pending: PendingApprovals) {
    use tokio::io::{AsyncBufReadExt, BufReader};
    let mut lines = BufReader::new(tokio::io::stdin()).lines();

    while let Ok(Some(line)) = lines.next_line().await {
        let line = line.trim().to_string();
        let mut parts = line.splitn(2, ' ');
        let (cmd, id) = match (parts.next(), parts.next()) {
            (Some(c), Some(i)) => (c, i.trim()),
            _ => {
                eprintln!("usage: y <tool_use_id> | n <tool_use_id>");
                continue;
            }
        };
        let decision = if cmd == "y" {
            Decision::Allow
        } else {
            Decision::Deny
        };
        if let Some(tx) = pending.lock().await.remove(id) {
            let _ = tx.send(decision);
            tracing::info!("stdin approval: {} {}", cmd, id);
        } else {
            tracing::warn!("no pending approval for stdin input: {}", id);
        }
    }
}

fn unix_ts() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}
