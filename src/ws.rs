// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc, Mutex,
};

use anyhow::{Context, Result};
use futures_util::{SinkExt, StreamExt};
use rand::Rng;
use ring::rand::SecureRandom;
use rusqlite::Connection;
use serde_json::Value;
use subtle::ConstantTimeEq;
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::TcpListener;
use tokio::sync::{broadcast, oneshot};
use tokio_rustls::TlsAcceptor;
use tokio_tungstenite::{accept_async, tungstenite::Message};

use crate::config::Config;
use crate::db;
use crate::{BufferedDecisions, Decision, PendingApprovals, Sessions};

/// Broadcast channel payload: (seq, unix_ts, raw_json_string)
pub type EventTx = broadcast::Sender<(i64, f64, String)>;

pub fn load_tls_acceptor(cfg: &Config) -> Result<Option<TlsAcceptor>> {
    let (Some(cert_path), Some(key_path)) = (&cfg.tls_cert_path, &cfg.tls_key_path) else {
        return Ok(None);
    };

    let cert_file = &mut std::io::BufReader::new(
        std::fs::File::open(cert_path)
            .with_context(|| format!("failed to open TLS cert {cert_path}"))?,
    );
    let key_file = &mut std::io::BufReader::new(
        std::fs::File::open(key_path)
            .with_context(|| format!("failed to open TLS key {key_path}"))?,
    );

    let certs: Vec<_> = rustls_pemfile::certs(cert_file)
        .collect::<std::result::Result<_, _>>()
        .context("failed to parse TLS cert PEM")?;
    let key = rustls_pemfile::private_key(key_file)
        .context("failed to parse TLS key PEM")?
        .context("no private key found in PEM file")?;

    let tls_config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::ring::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .context("failed to set TLS protocol versions")?
    .with_no_client_auth()
    .with_single_cert(certs, key)
    .context("failed to build TLS server config")?;

    Ok(Some(TlsAcceptor::from(Arc::new(tls_config))))
}

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
    tls_acceptor: Option<TlsAcceptor>,
) -> Result<()> {
    let addr = format!("0.0.0.0:{port}");
    let listener = TcpListener::bind(&addr)
        .await
        .with_context(|| format!("failed to bind WebSocket on {addr}"))?;
    let scheme = if tls_acceptor.is_some() { "wss" } else { "ws" };
    tracing::info!("WebSocket listening on {scheme}://{addr}");

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
                let tls = tls_acceptor.clone();
                tokio::spawn(async move {
                    let result = if let Some(acceptor) = tls {
                        match acceptor.accept(stream).await {
                            Ok(tls_stream) => {
                                handle_ws(
                                    tls_stream,
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
                            }
                            Err(e) => {
                                tracing::error!(%peer, "TLS handshake failed: {e}");
                                return;
                            }
                        }
                    } else {
                        handle_ws(
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
                    };
                    if let Err(e) = result {
                        tracing::error!("WS connection error: {e:#}");
                    }
                });
            }
            Err(e) => tracing::error!("WS accept error: {e}"),
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn handle_ws<S>(
    stream: S,
    token: String,
    db: Arc<Mutex<Connection>>,
    pending: PendingApprovals,
    buffered: BufferedDecisions,
    mut events_rx: broadcast::Receiver<(i64, f64, String)>,
    events_tx: EventTx,
    sessions: Sessions,
    max_concurrent: usize,
    cfg: Arc<Config>,
) -> Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let ws = accept_async(stream).await.context("WS upgrade failed")?;
    let (mut sink, mut src) = ws.split();

    // ── Phase 1: Authentication ───────────────────────────────────────────────
    let client_id = match src.next().await {
        Some(Ok(Message::Text(txt))) => {
            let msg: Value = serde_json::from_str(&txt).context("invalid hello JSON")?;
            if msg.get("type").and_then(|v| v.as_str()) != Some("hello") {
                let _ = sink.send(rejected("expected hello as first message")).await;
                return Ok(());
            }

            let version = msg.get("version").and_then(|v| v.as_u64()).unwrap_or(1);

            if version >= 2 {
                // Challenge-response: token never crosses the wire.
                let nonce = generate_nonce()?;
                let challenge = serde_json::to_string(&serde_json::json!({
                    "type": "challenge",
                    "nonce": nonce,
                }))
                .unwrap();
                sink.send(Message::Text(challenge))
                    .await
                    .context("failed to send challenge")?;

                match src.next().await {
                    Some(Ok(Message::Text(resp_txt))) => {
                        let resp: Value = serde_json::from_str(&resp_txt)
                            .context("invalid challenge_response JSON")?;
                        if resp.get("type").and_then(|v| v.as_str()) != Some("challenge_response") {
                            let _ = sink.send(rejected("expected challenge_response")).await;
                            return Ok(());
                        }
                        let provided_hmac = resp.get("hmac").and_then(|v| v.as_str()).unwrap_or("");
                        if !verify_hmac(&token, &nonce, provided_hmac) {
                            let _ = sink.send(rejected("bad hmac")).await;
                            return Ok(());
                        }
                    }
                    _ => return Ok(()),
                }
            } else {
                // Legacy v1: plaintext token (backward compat).
                tracing::warn!(
                    "v1 plaintext token auth used — upgrade client to v2 challenge-response"
                );
                let provided = msg.get("token").and_then(|v| v.as_str()).unwrap_or("");
                if !constant_time_token_eq(provided, &token) {
                    let _ = sink.send(rejected("bad token")).await;
                    return Ok(());
                }
            }

            msg.get("client_id")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string()
        }
        _ => return Ok(()),
    };

    // Check device revocation and upsert on successful auth
    let device_revoked = {
        let conn = db.lock().unwrap();
        db::is_device_revoked(&conn, &client_id).unwrap_or(false)
    };
    if device_revoked {
        let _ = sink.send(rejected("device revoked")).await;
        tracing::warn!(%client_id, "rejected: device revoked");
        return Ok(());
    }
    {
        let conn = db.lock().unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        let _ = db::upsert_device(&conn, &client_id, &client_id, now);
    }

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
    let caught_up =
        serde_json::to_string(&serde_json::json!({"type": "caught-up", "seq": last_seq}))?;
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

                                    let inject_secrets = v
                                        .get("inject_secrets")
                                        .and_then(|v| v.as_bool())
                                        .unwrap_or(false);

                                    let req = crate::RunRequest {
                                        prompt: prompt.to_string(),
                                        container,
                                        dangerously_skip_permissions,
                                        work_dir,
                                        command,
                                        inject_secrets,
                                    };
                                    let run_token = token.clone();
                                    tokio::spawn(crate::run_session(
                                        session_id.clone(),
                                        req,
                                        sessions.clone(),
                                        db.clone(),
                                        pending.clone(),
                                        events_tx.clone(),
                                        kill_rx,
                                        run_token,
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
                                    .publish("navetted test", "Mobile onboarding test", "default", &["bell"])
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
                            } else if msg_type == "read_file" {
                                let raw_path = v.get("path").and_then(|p| p.as_str()).unwrap_or("");
                                let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
                                let expanded = if raw_path.starts_with("~/") || raw_path == "~" {
                                    raw_path.replacen('~', &home, 1)
                                } else {
                                    raw_path.to_string()
                                };
                                let canonical = std::fs::canonicalize(&expanded)
                                    .unwrap_or_else(|_| std::path::PathBuf::from(&expanded));

                                let response = if !canonical.starts_with(&home) {
                                    serde_json::json!({
                                        "type": "file_content",
                                        "path": canonical.to_string_lossy(),
                                        "error": "path is outside home directory"
                                    })
                                } else {
                                    match std::fs::metadata(&canonical) {
                                        Ok(meta) => {
                                            const MAX_SIZE: u64 = 500 * 1024;
                                            if meta.len() > MAX_SIZE {
                                                serde_json::json!({
                                                    "type": "file_content",
                                                    "path": canonical.to_string_lossy(),
                                                    "size": meta.len(),
                                                    "error": "file too large (max 500KB)"
                                                })
                                            } else {
                                                match std::fs::read(&canonical) {
                                                    Ok(bytes) => {
                                                        let check_len = bytes.len().min(8192);
                                                        if bytes[..check_len].contains(&0) {
                                                            serde_json::json!({
                                                                "type": "file_content",
                                                                "path": canonical.to_string_lossy(),
                                                                "size": bytes.len(),
                                                                "error": "binary file, cannot display"
                                                            })
                                                        } else {
                                                            let content = String::from_utf8_lossy(&bytes);
                                                            serde_json::json!({
                                                                "type": "file_content",
                                                                "path": canonical.to_string_lossy(),
                                                                "content": content,
                                                                "size": bytes.len()
                                                            })
                                                        }
                                                    }
                                                    Err(e) => serde_json::json!({
                                                        "type": "file_content",
                                                        "path": canonical.to_string_lossy(),
                                                        "error": e.to_string()
                                                    }),
                                                }
                                            }
                                        }
                                        Err(e) => serde_json::json!({
                                            "type": "file_content",
                                            "path": canonical.to_string_lossy(),
                                            "error": e.to_string()
                                        }),
                                    }
                                };
                                tracing::debug!(%client_id, path = %canonical.display(), "read_file");
                                if let Ok(s) = serde_json::to_string(&response) {
                                    if sink.send(Message::Text(s)).await.is_err() {
                                        break;
                                    }
                                }
                            } else if msg_type == "write_file" {
                                let raw_path = v.get("path").and_then(|p| p.as_str()).unwrap_or("");
                                let content = v.get("content").and_then(|c| c.as_str()).unwrap_or("");
                                let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
                                let expanded = if raw_path.starts_with("~/") || raw_path == "~" {
                                    raw_path.replacen('~', &home, 1)
                                } else {
                                    raw_path.to_string()
                                };
                                let path = std::path::Path::new(&expanded);
                                let parent = path.parent().unwrap_or(path);
                                let canonical_parent = std::fs::canonicalize(parent)
                                    .unwrap_or_else(|_| parent.to_path_buf());
                                let canonical = canonical_parent.join(
                                    path.file_name().unwrap_or_default()
                                );

                                let response = if !canonical.starts_with(&home) {
                                    serde_json::json!({
                                        "type": "file_written",
                                        "path": canonical.to_string_lossy(),
                                        "ok": false,
                                        "error": "path is outside home directory"
                                    })
                                } else if !canonical.to_string_lossy().contains("/.claude/") {
                                    serde_json::json!({
                                        "type": "file_written",
                                        "path": canonical.to_string_lossy(),
                                        "ok": false,
                                        "error": "writes restricted to .claude/ directory"
                                    })
                                } else {
                                    let tmp_path = canonical.with_extension("tmp");
                                    match std::fs::write(&tmp_path, content) {
                                        Ok(()) => match std::fs::rename(&tmp_path, &canonical) {
                                            Ok(()) => serde_json::json!({
                                                "type": "file_written",
                                                "path": canonical.to_string_lossy(),
                                                "ok": true
                                            }),
                                            Err(e) => {
                                                let _ = std::fs::remove_file(&tmp_path);
                                                serde_json::json!({
                                                    "type": "file_written",
                                                    "path": canonical.to_string_lossy(),
                                                    "ok": false,
                                                    "error": e.to_string()
                                                })
                                            }
                                        },
                                        Err(e) => serde_json::json!({
                                            "type": "file_written",
                                            "path": canonical.to_string_lossy(),
                                            "ok": false,
                                            "error": e.to_string()
                                        }),
                                    }
                                };
                                tracing::debug!(%client_id, path = %canonical.display(), "write_file");
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
                            } else if msg_type == "list_prompts" {
                                let db2 = db.clone();
                                let prompts = tokio::task::spawn_blocking(move || {
                                    let conn = db2.lock().unwrap();
                                    db::list_prompts(&conn)
                                })
                                .await
                                .context("spawn_blocking panicked")?
                                .unwrap_or_default();
                                let reply = serde_json::to_string(&serde_json::json!({
                                    "type": "prompts_list",
                                    "prompts": prompts,
                                }))
                                .unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "save_prompt" {
                                let title = v.get("title").and_then(|v| v.as_str()).unwrap_or("");
                                let body = v.get("body").and_then(|v| v.as_str()).unwrap_or("");
                                let tags = v.get("tags").unwrap_or(&serde_json::json!([])).to_string();
                                let prompt_id = new_session_id();
                                let now = unix_ts();
                                {
                                    let conn = db.lock().unwrap();
                                    let _ = db::insert_prompt(&conn, &prompt_id, title, body, &tags, now);
                                }
                                tracing::info!(%client_id, %prompt_id, "prompt saved");
                                let reply = serde_json::to_string(&serde_json::json!({
                                    "type": "prompt_saved",
                                    "id": prompt_id,
                                }))
                                .unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "update_prompt" {
                                let prompt_id = v.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let title = v.get("title").and_then(|v| v.as_str()).unwrap_or("");
                                let body = v.get("body").and_then(|v| v.as_str()).unwrap_or("");
                                let tags = v.get("tags").unwrap_or(&serde_json::json!([])).to_string();
                                let now = unix_ts();
                                {
                                    let conn = db.lock().unwrap();
                                    let _ = db::update_prompt(&conn, &prompt_id, title, body, &tags, now);
                                }
                                tracing::info!(%client_id, %prompt_id, "prompt updated");
                                let reply = serde_json::to_string(&serde_json::json!({
                                    "type": "prompt_updated",
                                    "id": prompt_id,
                                }))
                                .unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "delete_prompt" {
                                let prompt_id = v.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                {
                                    let conn = db.lock().unwrap();
                                    let _ = db::delete_prompt(&conn, &prompt_id);
                                }
                                tracing::info!(%client_id, %prompt_id, "prompt deleted");
                                let reply = serde_json::to_string(&serde_json::json!({
                                    "type": "prompt_deleted",
                                    "id": prompt_id,
                                }))
                                .unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "list_secrets" {
                                let db2 = db.clone();
                                let list_token = token.clone();
                                let secrets_list = tokio::task::spawn_blocking(move || {
                                    let conn = db2.lock().unwrap();
                                    let names = db::list_secrets(&conn)?;
                                    let key = db::derive_secret_key(&list_token)?;
                                    let mut out = Vec::new();
                                    for (name, created_at, updated_at) in &names {
                                        let masked = match db::get_secret_encrypted(&conn, name)? {
                                            Some((enc, non)) => {
                                                let plain = db::decrypt_secret(&key, &enc, &non)
                                                    .unwrap_or_default();
                                                let s = String::from_utf8_lossy(&plain);
                                                if s.len() >= 4 {
                                                    format!("••••{}", &s[s.len() - 4..])
                                                } else {
                                                    "••••".to_string()
                                                }
                                            }
                                            None => "••••".to_string(),
                                        };
                                        out.push(serde_json::json!({
                                            "name": name,
                                            "masked": masked,
                                            "created_at": created_at,
                                            "updated_at": updated_at,
                                        }));
                                    }
                                    Ok::<_, anyhow::Error>(out)
                                })
                                .await
                                .context("spawn_blocking panicked")?
                                .unwrap_or_default();
                                let reply = serde_json::to_string(&serde_json::json!({
                                    "type": "secrets_list",
                                    "secrets": secrets_list,
                                }))
                                .unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "set_secret" {
                                let name = v.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let value = v.get("value").and_then(|v| v.as_str()).unwrap_or("");
                                if name.is_empty() || value.is_empty() {
                                    let reply = serde_json::to_string(&serde_json::json!({
                                        "type": "error",
                                        "message": "name and value are required",
                                    }))
                                    .unwrap_or_default();
                                    if sink.send(Message::Text(reply)).await.is_err() {
                                        break;
                                    }
                                } else if value.len() > 10_240 {
                                    let reply = serde_json::to_string(&serde_json::json!({
                                        "type": "error",
                                        "message": "secret value exceeds 10KB limit",
                                    }))
                                    .unwrap_or_default();
                                    if sink.send(Message::Text(reply)).await.is_err() {
                                        break;
                                    }
                                } else {
                                    let set_token = token.clone();
                                    let set_value = value.to_string();
                                    let set_name = name.clone();
                                    let db2 = db.clone();
                                    let save_result = tokio::task::spawn_blocking(move || {
                                        let key = db::derive_secret_key(&set_token)?;
                                        let (encrypted, nonce) = db::encrypt_secret(&key, set_value.as_bytes())?;
                                        let conn = db2.lock().unwrap();
                                        db::set_secret(&conn, &set_name, &encrypted, &nonce, unix_ts())
                                    })
                                    .await
                                    .context("spawn_blocking panicked")?;
                                    let reply = match save_result {
                                        Ok(()) => {
                                            tracing::info!(%client_id, secret_name = %name, "secret saved");
                                            serde_json::to_string(&serde_json::json!({
                                                "type": "secret_saved",
                                                "name": name,
                                            }))
                                            .unwrap_or_default()
                                        }
                                        Err(e) => {
                                            tracing::error!(%client_id, "set_secret failed: {e:#}");
                                            serde_json::to_string(&serde_json::json!({
                                                "type": "error",
                                                "message": "failed to save secret",
                                            }))
                                            .unwrap_or_default()
                                        }
                                    };
                                    if sink.send(Message::Text(reply)).await.is_err() {
                                        break;
                                    }
                                }
                            } else if msg_type == "delete_secret" {
                                let name = v.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                {
                                    let conn = db.lock().unwrap();
                                    let _ = db::delete_secret(&conn, &name);
                                }
                                tracing::info!(%client_id, secret_name = %name, "secret deleted");
                                let reply = serde_json::to_string(&serde_json::json!({
                                    "type": "secret_deleted",
                                    "name": name,
                                }))
                                .unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "list_devices" {
                                let devices = {
                                    let conn = db.lock().unwrap();
                                    db::list_devices(&conn).unwrap_or_default()
                                };
                                let reply = serde_json::to_string(&serde_json::json!({
                                    "type": "devices_list",
                                    "devices": devices,
                                }))
                                .unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "revoke_device" {
                                let device_id = v.get("device_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                {
                                    let conn = db.lock().unwrap();
                                    let _ = db::set_device_revoked(&conn, &device_id, true);
                                }
                                tracing::info!(%client_id, %device_id, "device revoked");
                                let reply = serde_json::to_string(&serde_json::json!({
                                    "type": "device_revoked",
                                    "device_id": device_id,
                                }))
                                .unwrap_or_default();
                                if sink.send(Message::Text(reply)).await.is_err() {
                                    break;
                                }
                            } else if msg_type == "rename_device" {
                                let device_id = v.get("device_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                let name = v.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                                {
                                    let conn = db.lock().unwrap();
                                    let _ = db::rename_device(&conn, &device_id, &name);
                                }
                                tracing::info!(%client_id, %device_id, new_name = %name, "device renamed");
                                let reply = serde_json::to_string(&serde_json::json!({
                                    "type": "device_renamed",
                                    "device_id": device_id,
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
                    #[allow(clippy::collapsible_match)]
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

fn generate_nonce() -> Result<String> {
    let mut buf = [0u8; 32];
    ring::rand::SystemRandom::new()
        .fill(&mut buf)
        .map_err(|_| anyhow::anyhow!("system RNG failed"))?;
    Ok(hex::encode(buf))
}

fn verify_hmac(token: &str, nonce: &str, provided_hex: &str) -> bool {
    let Ok(provided_bytes) = hex::decode(provided_hex) else {
        return false;
    };
    let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, token.as_bytes());
    ring::hmac::verify(&key, nonce.as_bytes(), &provided_bytes).is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn challenge_response_success() {
        let token = "test-secret-token-abc123";
        let nonce = generate_nonce().unwrap();
        assert_eq!(nonce.len(), 64);

        let key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, token.as_bytes());
        let tag = ring::hmac::sign(&key, nonce.as_bytes());
        let hmac_hex = hex::encode(tag.as_ref());

        assert!(verify_hmac(token, &nonce, &hmac_hex));
    }

    #[test]
    fn challenge_response_wrong_hmac() {
        let token = "correct-token";
        let nonce = generate_nonce().unwrap();

        let wrong_key = ring::hmac::Key::new(ring::hmac::HMAC_SHA256, b"wrong-token");
        let wrong_tag = ring::hmac::sign(&wrong_key, nonce.as_bytes());
        let wrong_hex = hex::encode(wrong_tag.as_ref());

        assert!(!verify_hmac(token, &nonce, &wrong_hex));
    }

    #[test]
    fn challenge_response_invalid_hex() {
        assert!(!verify_hmac("token", "nonce", "not-valid-hex!!!"));
    }

    #[test]
    fn legacy_token_auth() {
        assert!(constant_time_token_eq("my-secret", "my-secret"));
        assert!(!constant_time_token_eq("my-secret", "wrong"));
        assert!(!constant_time_token_eq("short", "longer-token"));
    }

    #[test]
    fn load_tls_acceptor_none_when_no_paths() {
        let cfg = crate::config::Config {
            token: "t".to_string(),
            ws_port: 7878,
            approval_ttl_secs: 300,
            approval_warn_before_secs: 30,
            max_concurrent_sessions: 4,
            notify: crate::config::NotifyConfig {
                ntfy_base_url: String::new(),
                ntfy_topic: String::new(),
                ntfy_token: String::new(),
                telegram_bot_token: String::new(),
                telegram_chat_id: String::new(),
            },
            tls_cert_path: None,
            tls_key_path: None,
        };
        assert!(load_tls_acceptor(&cfg).unwrap().is_none());
    }

    #[test]
    fn load_tls_acceptor_with_generated_cert() {
        let dir = std::env::temp_dir().join("navetted-test-tls-acceptor");
        std::fs::create_dir_all(&dir).unwrap();
        let cert = dir.join("cert.pem");
        let key = dir.join("key.pem");
        crate::config::generate_self_signed_cert_for_test(&cert, &key);

        let cfg = crate::config::Config {
            token: "t".to_string(),
            ws_port: 7878,
            approval_ttl_secs: 300,
            approval_warn_before_secs: 30,
            max_concurrent_sessions: 4,
            notify: crate::config::NotifyConfig {
                ntfy_base_url: String::new(),
                ntfy_topic: String::new(),
                ntfy_token: String::new(),
                telegram_bot_token: String::new(),
                telegram_chat_id: String::new(),
            },
            tls_cert_path: Some(cert.to_string_lossy().into_owned()),
            tls_key_path: Some(key.to_string_lossy().into_owned()),
        };
        assert!(load_tls_acceptor(&cfg).unwrap().is_some());

        std::fs::remove_dir_all(&dir).ok();
    }
}
