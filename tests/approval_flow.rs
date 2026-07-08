// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

//! Integration test for the core approval loop: `navetted-hook` (spawned as a
//! real subprocess) talking over the Unix socket to an in-process
//! `hook::serve` listener, covering the allow, deny (via policy), and
//! timeout-auto-deny paths, plus the "decision arrives before the hook
//! connects" (buffered) path that the WS/HTTP handlers exercise in
//! production.
//!
//! `hook::serve` binds its socket path from `$XDG_RUNTIME_DIR` at call time,
//! which is process-wide mutable state — tests run in separate OS threads
//! within one process, so all scenarios funnel through `run_serialized` to
//! avoid one test's runtime dir/env leaking into another's.

use std::io::Write;
use std::process::Stdio;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use rusqlite::Connection;
use tokio::sync::broadcast;

use navetted::hook;
use navetted::{BufferedDecisions, Decision, PendingApprovals};

fn env_guard() -> &'static Mutex<()> {
    static GUARD: OnceLock<Mutex<()>> = OnceLock::new();
    GUARD.get_or_init(|| Mutex::new(()))
}

/// In-memory DB with just the tables `hook.rs` touches.
fn test_db() -> Arc<Mutex<Connection>> {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE events (
             seq        INTEGER PRIMARY KEY AUTOINCREMENT,
             ts         REAL    NOT NULL,
             json       TEXT    NOT NULL,
             session_id TEXT    NOT NULL DEFAULT ''
         );
         CREATE TABLE approval_policy (
             tool_name  TEXT    PRIMARY KEY,
             action     TEXT    NOT NULL DEFAULT 'prompt',
             created_at REAL    NOT NULL,
             updated_at REAL    NOT NULL
         );",
    )
    .unwrap();
    Arc::new(Mutex::new(conn))
}

/// Start `hook::serve` in-process against a scratch `$XDG_RUNTIME_DIR`, and
/// block (with a short poll loop) until the socket file actually exists so
/// the caller can immediately spawn `navetted-hook` without a race.
///
/// Caller must hold `env_guard()` for the duration of the scenario, since
/// this mutates the process-wide `XDG_RUNTIME_DIR` env var.
async fn start_hook_server(
    runtime_dir: &std::path::Path,
    db: Arc<Mutex<Connection>>,
    approval_ttl_secs: u64,
    approval_warn_before_secs: u64,
) -> (
    PendingApprovals,
    BufferedDecisions,
    broadcast::Receiver<(i64, f64, String)>,
) {
    std::env::set_var("XDG_RUNTIME_DIR", runtime_dir);

    let pending: PendingApprovals = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let buffered: BufferedDecisions = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
    let (events_tx, events_rx) = broadcast::channel::<(i64, f64, String)>(64);

    tokio::spawn(hook::serve(
        pending.clone(),
        buffered.clone(),
        events_tx,
        db,
        approval_ttl_secs,
        approval_warn_before_secs,
    ));

    let socket_path = runtime_dir.join("navetted").join("hook.sock");
    for _ in 0..100 {
        if socket_path.exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(
        socket_path.exists(),
        "hook socket never appeared at {socket_path:?}"
    );

    (pending, buffered, events_rx)
}

/// Run the built `navetted-hook` binary against the currently-bound socket,
/// feeding it crafted PreToolUse JSON on stdin. Returns (exit_code, stderr).
fn run_hook_binary(runtime_dir: &std::path::Path, tool_use_id: &str, tool_name: &str) -> (i32, String) {
    let input = serde_json::json!({
        "tool_use_id": tool_use_id,
        "tool_name": tool_name,
        "tool_input": {},
    });

    let mut child = std::process::Command::new(env!("CARGO_BIN_EXE_navetted-hook"))
        .env("XDG_RUNTIME_DIR", runtime_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("failed to spawn navetted-hook");

    child
        .stdin
        .take()
        .unwrap()
        .write_all(input.to_string().as_bytes())
        .unwrap();

    let output = child
        .wait_with_output()
        .expect("failed to wait on navetted-hook");

    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stderr).to_string(),
    )
}

#[tokio::test]
async fn policy_allow_returns_exit_0_with_no_pending_approval() {
    let _guard = env_guard().lock().unwrap();
    let runtime_dir = tempfile::tempdir().unwrap();
    let db = test_db();
    {
        let conn = db.lock().unwrap();
        navetted::db::set_approval_policy(&conn, "Bash", "allow", 0.0).unwrap();
    }

    let (pending, _buffered, _events_rx) =
        start_hook_server(runtime_dir.path(), db, 300, 30).await;

    let (code, stderr) = run_hook_binary(runtime_dir.path(), "tid-allow", "Bash");
    assert_eq!(code, 0, "expected allow exit code 0, stderr: {stderr}");
    assert!(
        pending.lock().await.is_empty(),
        "policy allow should short-circuit before registering a pending approval"
    );
}

#[tokio::test]
async fn policy_deny_returns_exit_2_and_emits_auto_denied_event() {
    let _guard = env_guard().lock().unwrap();
    let runtime_dir = tempfile::tempdir().unwrap();
    let db = test_db();
    {
        let conn = db.lock().unwrap();
        navetted::db::set_approval_policy(&conn, "Bash", "deny", 0.0).unwrap();
    }

    let (_pending, _buffered, mut events_rx) =
        start_hook_server(runtime_dir.path(), db, 300, 30).await;

    let (code, stderr) = run_hook_binary(runtime_dir.path(), "tid-deny", "Bash");
    assert_eq!(code, 2, "expected deny exit code 2, stderr: {stderr}");

    let (_, _, json) = tokio::time::timeout(Duration::from_secs(2), events_rx.recv())
        .await
        .expect("timed out waiting for auto-denied event")
        .unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["type"], "approval_auto_denied");
    assert_eq!(v["tool_use_id"], "tid-deny");
    assert_eq!(v["reason"], "policy");
}

#[tokio::test]
async fn buffered_decision_resolves_before_hook_connects() {
    let _guard = env_guard().lock().unwrap();
    let runtime_dir = tempfile::tempdir().unwrap();
    let db = test_db();

    let (_pending, buffered, mut events_rx) =
        start_hook_server(runtime_dir.path(), db, 300, 30).await;

    // Simulate a WS/HTTP client resolving the approval before the hook
    // binary ever connects — exactly what ws.rs's `input` handler and
    // http.rs's approve/deny handler do to `BufferedDecisions`.
    buffered
        .lock()
        .await
        .insert("tid-buffered".to_string(), Decision::Allow);

    let (code, stderr) = run_hook_binary(runtime_dir.path(), "tid-buffered", "Read");
    assert_eq!(code, 0, "expected allow exit code 0, stderr: {stderr}");

    // No approval_pending event should have been emitted since the decision
    // was already buffered.
    let recv = tokio::time::timeout(Duration::from_millis(300), events_rx.recv()).await;
    assert!(
        recv.is_err(),
        "buffered decisions should not emit an approval_pending event"
    );
}

#[tokio::test]
async fn pending_approval_resolves_when_decision_arrives_via_pending_map() {
    let _guard = env_guard().lock().unwrap();
    let runtime_dir = tempfile::tempdir().unwrap();
    let db = test_db();

    let (pending, _buffered, mut events_rx) =
        start_hook_server(runtime_dir.path(), db, 300, 30).await;

    // Spawn the hook binary; it blocks until a decision resolves the oneshot
    // sender registered in `pending`.
    let runtime_dir_path = runtime_dir.path().to_path_buf();
    let hook_task = tokio::task::spawn_blocking(move || {
        run_hook_binary(&runtime_dir_path, "tid-pending", "Write")
    });

    // Wait for the approval_pending event, then resolve it — mirrors what
    // ws.rs's `input` message handler does against the same `pending` map.
    let (_, _, json) = tokio::time::timeout(Duration::from_secs(2), events_rx.recv())
        .await
        .expect("timed out waiting for approval_pending event")
        .unwrap();
    let v: serde_json::Value = serde_json::from_str(&json).unwrap();
    assert_eq!(v["type"], "approval_pending");
    assert_eq!(v["tool_use_id"], "tid-pending");

    let tx = pending
        .lock()
        .await
        .remove("tid-pending")
        .expect("no pending sender registered for tid-pending");
    tx.send(Decision::Deny).unwrap();

    let (code, stderr) = tokio::time::timeout(Duration::from_secs(2), hook_task)
        .await
        .expect("hook binary timed out")
        .unwrap();
    assert_eq!(code, 2, "expected deny exit code 2, stderr: {stderr}");
}

#[tokio::test]
async fn unanswered_approval_times_out_to_auto_deny() {
    let _guard = env_guard().lock().unwrap();
    let runtime_dir = tempfile::tempdir().unwrap();
    let db = test_db();

    // 1s TTL, 0s warn-before, so this resolves quickly.
    let (_pending, _buffered, mut events_rx) =
        start_hook_server(runtime_dir.path(), db, 1, 0).await;

    let (code, stderr) = run_hook_binary(runtime_dir.path(), "tid-timeout", "Bash");
    assert_eq!(code, 2, "expected auto-deny exit code 2, stderr: {stderr}");

    // Drain events until we see approval_expired (approval_pending arrives first).
    let mut saw_expired = false;
    for _ in 0..5 {
        let recv = tokio::time::timeout(Duration::from_secs(2), events_rx.recv()).await;
        let Ok(Ok((_, _, json))) = recv else { break };
        let v: serde_json::Value = serde_json::from_str(&json).unwrap();
        if v["type"] == "approval_expired" {
            assert_eq!(v["tool_use_id"], "tid-timeout");
            assert_eq!(v["auto_decision"], "deny");
            saw_expired = true;
            break;
        }
    }
    assert!(saw_expired, "expected an approval_expired event");
}
