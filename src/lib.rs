// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

//! Library crate for the `navetted` daemon.
//!
//! Split out from `main.rs` so integration tests under `tests/` can drive
//! real daemon internals (e.g. `hook::serve`, `ws::serve`) in-process instead
//! of only being able to spawn the built binary as an opaque subprocess.

pub mod capture;
pub mod claude;
pub mod config;
pub mod db;
pub mod hook;
pub mod http;
pub mod notify;
pub mod ws;

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use anyhow::{Context, Result};
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
    pub agent_type: String,
    pub started_at: f64,
    /// Fires to kill the session; taken by the kill handler.
    pub kill_tx: Option<oneshot::Sender<()>>,
    /// Cumulative token counts updated atomically as events stream in.
    pub input_tokens: Arc<AtomicU64>,
    pub output_tokens: Arc<AtomicU64>,
    pub cache_read_tokens: Arc<AtomicU64>,
    /// Channel to send text input to the session's PTY stdin.
    pub pty_tx: Option<tokio::sync::mpsc::Sender<String>>,
}

/// Sent from a WS client to start a claude session.
pub struct RunRequest {
    pub prompt: String,
    pub container: Option<String>,
    pub dangerously_skip_permissions: bool,
    pub work_dir: Option<String>,
    pub command: Option<String>,
    pub agent: String,
    pub inject_secrets: bool,
}

/// If running inside a distrobox/toolbox container, re-exec on the host so that
/// `distrobox-enter` calls in `claude.rs` work correctly.  Returns `Some(exit_code)`
/// when re-exec happened (caller should exit), `None` when already on the host.
pub fn maybe_reexec_on_host() -> Result<Option<i32>> {
    if std::env::var_os("NAVETTED_ON_HOST").is_some() {
        return Ok(None);
    }
    if !std::path::Path::new("/run/.containerenv").exists() {
        return Ok(None);
    }
    let host_exec = std::env::var("PATH")
        .unwrap_or_default()
        .split(':')
        .map(|dir| std::path::PathBuf::from(dir).join("distrobox-host-exec"))
        .find(|p| p.exists())
        .context("inside a container but distrobox-host-exec not found on PATH")?;

    let exe = std::env::current_exe().context("failed to resolve own binary path")?;
    let args: Vec<String> = std::env::args().skip(1).collect();

    eprintln!(
        "navetted: detected container environment, re-launching on host via distrobox-host-exec"
    );

    let status = std::process::Command::new(host_exec)
        .arg(exe)
        .args(&args)
        .env("NAVETTED_ON_HOST", "1")
        .status()
        .context("failed to exec distrobox-host-exec")?;

    Ok(Some(status.code().unwrap_or(1)))
}

/// Runs the daemon: loads config, wires up all long-lived tokio tasks, and
/// blocks forever. Extracted from `main()` so both the `navetted` binary and
/// integration tests can start a real daemon instance.
pub async fn run_daemon() -> Result<()> {
    let cfg = Arc::new(config::load_or_create()?);
    let tls_acceptor = ws::load_tls_acceptor(&cfg)?;
    let http_port: u16 = cfg
        .ws_port
        .checked_add(1)
        .context("ws_port must be < 65535 for the HTTP API")?;
    tracing::info!(
        ws_port = cfg.ws_port,
        http_port,
        max_concurrent = cfg.max_concurrent_sessions,
        tls = tls_acceptor.is_some(),
        "config loaded"
    );

    let db = Arc::new(std::sync::Mutex::new(db::open()?));

    // Migrate secrets from token-derived key to standalone vault key (one-time, idempotent).
    {
        let conn = db.lock().unwrap();
        db::migrate_vault_if_needed(&conn, &cfg.token)?;
    }

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
        let api_token = cfg.token.clone();
        let api_base = cfg.notify.action_base_url.clone().unwrap_or_else(|| {
            let scheme = if cfg.tls_enabled() { "https" } else { "http" };
            let host = local_ip_address::local_ip()
                .map(|ip| ip.to_string())
                .unwrap_or_else(|_| "localhost".to_string());
            format!("{scheme}://{host}:{http_port}")
        });
        tokio::spawn(async move {
            while let Ok((_, _, json)) = notify_rx.recv().await {
                if let Ok(v) = serde_json::from_str::<serde_json::Value>(&json) {
                    match v.get("type").and_then(|t| t.as_str()).unwrap_or("") {
                        "approval_pending" => {
                            let tool_raw = v["tool_name"].as_str().unwrap_or("tool");
                            let tool_use_id = v["tool_use_id"].as_str().unwrap_or("");
                            if !tool_use_id.is_empty()
                                && tool_use_id
                                    .bytes()
                                    .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                            {
                                let allow_sig =
                                    http::approval_sig(&api_token, tool_use_id, "allow");
                                let deny_sig = http::approval_sig(&api_token, tool_use_id, "deny");
                                let actions = format!(
                                    "http, Allow, {api_base}/approve/{tool_use_id}/allow?sig={allow_sig}, method=POST; \
                                     http, Deny, {api_base}/approve/{tool_use_id}/deny?sig={deny_sig}, method=POST"
                                );
                                let _ = notify
                                    .publish_approval("Claude needs approval", tool_raw, &actions)
                                    .await;
                            } else {
                                let _ = notify
                                    .publish(
                                        "Claude needs approval",
                                        tool_raw,
                                        "default",
                                        &["warning"],
                                    )
                                    .await;
                            }
                            let tool = crate::notify::html_escape(tool_raw);
                            let _ = notify
                                .send_telegram(&format!("⚠️ Claude needs approval: {tool}"))
                                .await;
                        }
                        "approval_warning" => {
                            let secs = v["seconds_remaining"].as_u64().unwrap_or(30);
                            let body = format!("Expires in {secs}s");
                            let _ = notify
                                .publish("Approval expiring", &body, "high", &["stopwatch"])
                                .await;
                            let _ = notify
                                .send_telegram(&format!("⏱️ Approval expiring in {secs}s"))
                                .await;
                        }
                        "approval_expired" => {
                            let _ = notify
                                .publish("Auto-denied", "Approval timed out", "default", &[])
                                .await;
                            let _ = notify
                                .send_telegram("❌ Approval timed out and was auto-denied")
                                .await;
                        }
                        "session_ended" => {
                            let ok = v["ok"].as_bool().unwrap_or(false);
                            let (title, tag, emoji) = if ok {
                                ("Session done", "white_check_mark", "✓")
                            } else {
                                ("Session failed", "x", "✗")
                            };
                            let _ = notify.publish(title, "", "low", &[tag]).await;
                            let _ = notify
                                .send_telegram(&format!("{emoji} Session {title}"))
                                .await;
                            notify.publish_webhook(&v).await;
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
                    let (pty_input_tx, pty_input_rx) = tokio::sync::mpsc::channel::<String>(32);
                    scheduler_sessions.lock().await.insert(
                        session_id.clone(),
                        SessionEntry {
                            prompt: prompt.clone(),
                            container: container.clone(),
                            command: command.clone(),
                            agent_type: "claude".to_string(),
                            started_at: now,
                            kill_tx: Some(kill_tx),
                            input_tokens: Arc::new(std::sync::atomic::AtomicU64::new(0)),
                            output_tokens: Arc::new(std::sync::atomic::AtomicU64::new(0)),
                            cache_read_tokens: Arc::new(std::sync::atomic::AtomicU64::new(0)),
                            pty_tx: Some(pty_input_tx),
                        },
                    );
                    emit_session_list_changed(&scheduler_sessions, &scheduler_events_tx).await;

                    let req = RunRequest {
                        prompt,
                        container,
                        dangerously_skip_permissions: false,
                        work_dir: None,
                        command,
                        agent: "claude".to_string(),
                        inject_secrets: false,
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
                        pty_input_rx,
                    ));
                }
            }
        });
    }

    // WebSocket server
    let tls_for_http = tls_acceptor.clone();
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
        tls_acceptor,
    ));

    // HTTP API for ntfy action button callbacks (approve/deny)
    tokio::spawn(http::serve(
        http_port,
        cfg.token.clone(),
        pending.clone(),
        buffered.clone(),
        tls_for_http,
    ));

    // Stdin fallback approvals (useful for debugging without a WS client)
    tokio::spawn(read_stdin_approvals(pending.clone()));

    tracing::info!("navetted ready — waiting for run requests");

    // Keep the process alive; all work is driven by spawned tasks.
    std::future::pending::<()>().await;
    Ok(())
}

/// Lifecycle for a single claude session. Spawned by the WS handler.
#[allow(clippy::too_many_arguments)]
pub async fn run_session(
    session_id: String,
    req: RunRequest,
    sessions: Sessions,
    db: Arc<std::sync::Mutex<Connection>>,
    pending: PendingApprovals,
    events_tx: ws::EventTx,
    kill_rx: oneshot::Receiver<()>,
    pty_input_rx: tokio::sync::mpsc::Receiver<String>,
) {
    let ts = unix_ts();
    let started_json = serde_json::to_string(&serde_json::json!({
        "type": "session_started",
        "session_id": &session_id,
        "prompt": &req.prompt,
        "container": req.container,
        "dangerously_skip_permissions": req.dangerously_skip_permissions,
        "command": req.command,
        "agent_type": req.agent,
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
            Some(e) => (
                e.input_tokens.clone(),
                e.output_tokens.clone(),
                e.cache_read_tokens.clone(),
            ),
            None => (
                Arc::new(AtomicU64::new(0)),
                Arc::new(AtomicU64::new(0)),
                Arc::new(AtomicU64::new(0)),
            ),
        }
    };

    let secrets: HashMap<String, String> = if req.inject_secrets {
        match db::load_or_create_vault_key() {
            Ok(key) => {
                let conn = db.lock().unwrap();
                let names = db::list_secrets(&conn).unwrap_or_default();
                let mut map = HashMap::new();
                for (name, _, _) in &names {
                    if let Ok(Some((enc, non))) = db::get_secret_encrypted(&conn, name) {
                        if let Ok(plaintext) = db::decrypt_secret(&key, &enc, &non) {
                            if let Ok(val) = String::from_utf8(plaintext) {
                                map.insert(name.clone(), val);
                            }
                        }
                    }
                }
                tracing::info!(secret_count = map.len(), "injecting secrets into session");
                map
            }
            Err(e) => {
                tracing::error!("failed to derive secret key: {e:#}");
                HashMap::new()
            }
        }
    } else {
        HashMap::new()
    };

    let result = claude::spawn_and_process(
        &req.prompt,
        req.container.as_deref(),
        req.dangerously_skip_permissions,
        req.work_dir.as_deref(),
        req.command.as_deref(),
        &req.agent,
        &session_id,
        kill_rx,
        db.clone(),
        pending,
        events_tx.clone(),
        input_tokens,
        output_tokens,
        cache_read_tokens,
        &secrets,
        pty_input_rx,
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
                "agent_type": e.agent_type,
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

pub(crate) fn unix_ts() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
}
