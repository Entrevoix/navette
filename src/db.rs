// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

use std::os::unix::fs::PermissionsExt;

use anyhow::{Context, Result};
use rusqlite::Connection;

pub fn open() -> Result<Connection> {
    let data_dir = data_dir()?;
    std::fs::create_dir_all(&data_dir)
        .with_context(|| format!("failed to create data dir {}", data_dir.display()))?;
    let db_path = data_dir.join("events.db");
    let conn = Connection::open(&db_path)
        .with_context(|| format!("failed to open DB at {}", db_path.display()))?;
    // Restrict the database file to owner-only access (rw-------).
    std::fs::set_permissions(&db_path, std::fs::Permissions::from_mode(0o600))
        .with_context(|| format!("failed to set permissions on {}", db_path.display()))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS events (
             seq  INTEGER PRIMARY KEY AUTOINCREMENT,
             ts   REAL    NOT NULL,
             json TEXT    NOT NULL
         );
         CREATE TABLE IF NOT EXISTS scheduled_sessions (
             id           TEXT    PRIMARY KEY,
             prompt       TEXT    NOT NULL,
             container    TEXT,
             command      TEXT,
             scheduled_at REAL    NOT NULL,
             created_at   REAL    NOT NULL,
             fired        INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS prompt_library (
             id         TEXT    PRIMARY KEY,
             title      TEXT    NOT NULL,
             body       TEXT    NOT NULL,
             tags       TEXT    NOT NULL DEFAULT '[]',
             created_at REAL    NOT NULL,
             updated_at REAL    NOT NULL
         );",
    )
    .context("failed to initialize schema")?;
    // Migration: add session_id column for multi-session support (idempotent).
    let _ = conn.execute(
        "ALTER TABLE events ADD COLUMN session_id TEXT NOT NULL DEFAULT ''",
        [],
    );
    tracing::info!("DB opened at {}", db_path.display());
    Ok(conn)
}

/// Insert one event. Returns the assigned seq number.
/// session_id is auto-extracted from the JSON payload via json_extract.
pub fn insert_event(conn: &Connection, ts: f64, json: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO events (ts, json, session_id) VALUES (?1, ?2, COALESCE(json_extract(?2, '$.session_id'), ''))",
        rusqlite::params![ts, json],
    )
    .context("insert_event failed")?;
    Ok(conn.last_insert_rowid())
}

/// Return all events with seq > since, in order.
pub fn events_since(conn: &Connection, since: i64) -> Result<Vec<(i64, f64, String)>> {
    let mut stmt = conn
        .prepare("SELECT seq, ts, json FROM events WHERE seq > ?1 ORDER BY seq")
        .context("prepare events_since")?;
    let rows = stmt
        .query_map(rusqlite::params![since], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .context("query events_since")?
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("collect events_since")?;
    Ok(rows)
}

/// Return the highest seq currently in the DB (0 if empty).
pub fn head_seq(conn: &Connection) -> Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(seq), 0) FROM events",
        [],
        |r| r.get(0),
    )
    .context("head_seq failed")
}

/// Return distinct sessions ordered by most recent activity, up to 50.
pub fn get_session_list(conn: &Connection) -> Result<Vec<serde_json::Value>> {
    let mut stmt = conn
        .prepare(
            "SELECT session_id, COUNT(*) as event_count, MIN(ts) as started_at, MAX(ts) as last_event
             FROM events WHERE session_id != '' GROUP BY session_id ORDER BY MIN(ts) DESC LIMIT 50",
        )
        .context("prepare get_session_list")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, f64>(3)?,
            ))
        })
        .context("query get_session_list")?
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("collect get_session_list")?;
    Ok(rows
        .into_iter()
        .map(|(session_id, event_count, started_at, last_event)| {
            serde_json::json!({
                "session_id": session_id,
                "event_count": event_count,
                "started_at": started_at,
                "last_event": last_event,
            })
        })
        .collect())
}

/// Return all events for a specific session, ordered by seq.
pub fn get_session_events(conn: &Connection, session_id: &str) -> Result<Vec<serde_json::Value>> {
    let mut stmt = conn
        .prepare("SELECT seq, ts, json FROM events WHERE session_id = ?1 ORDER BY seq ASC")
        .context("prepare get_session_events")?;
    let rows = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .context("query get_session_events")?
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("collect get_session_events")?;
    Ok(rows
        .into_iter()
        .map(|(seq, ts, json)| {
            let event: serde_json::Value =
                serde_json::from_str(&json).unwrap_or(serde_json::Value::Null);
            serde_json::json!({
                "seq": seq,
                "ts": ts,
                "event": event,
            })
        })
        .collect())
}

/// Insert a scheduled session.
pub fn insert_scheduled_session(
    conn: &Connection,
    id: &str,
    prompt: &str,
    container: Option<&str>,
    command: Option<&str>,
    scheduled_at: f64,
    created_at: f64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO scheduled_sessions (id, prompt, container, command, scheduled_at, created_at, fired)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 0)",
        rusqlite::params![id, prompt, container, command, scheduled_at, created_at],
    )
    .context("insert_scheduled_session failed")?;
    Ok(())
}

/// Return all pending (not yet fired) scheduled sessions.
pub fn get_pending_scheduled_sessions(conn: &Connection) -> Result<Vec<serde_json::Value>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, prompt, container, command, scheduled_at, created_at
             FROM scheduled_sessions WHERE fired = 0 ORDER BY scheduled_at ASC",
        )
        .context("prepare get_pending_scheduled_sessions")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, f64>(5)?,
            ))
        })
        .context("query get_pending_scheduled_sessions")?
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("collect get_pending_scheduled_sessions")?;
    Ok(rows
        .into_iter()
        .map(|(id, prompt, container, command, scheduled_at, created_at)| {
            serde_json::json!({
                "id": id,
                "prompt": prompt,
                "container": container,
                "command": command,
                "scheduled_at": scheduled_at,
                "created_at": created_at,
                "fired": false,
            })
        })
        .collect())
}

/// Mark a scheduled session as fired so it won't run again.
pub fn mark_scheduled_session_fired(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "UPDATE scheduled_sessions SET fired = 1 WHERE id = ?1",
        rusqlite::params![id],
    )
    .context("mark_scheduled_session_fired failed")?;
    Ok(())
}

/// Delete a scheduled session (cancel).
pub fn delete_scheduled_session(conn: &Connection, id: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM scheduled_sessions WHERE id = ?1",
        rusqlite::params![id],
    )
    .context("delete_scheduled_session failed")?;
    Ok(())
}

/// List all scheduled sessions (pending and fired), most recent first.
pub fn list_scheduled_sessions(conn: &Connection) -> Result<Vec<serde_json::Value>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, prompt, container, command, scheduled_at, created_at, fired
             FROM scheduled_sessions ORDER BY scheduled_at DESC",
        )
        .context("prepare list_scheduled_sessions")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, f64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })
        .context("query list_scheduled_sessions")?
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("collect list_scheduled_sessions")?;
    Ok(rows
        .into_iter()
        .map(|(id, prompt, container, command, scheduled_at, created_at, fired)| {
            serde_json::json!({
                "id": id,
                "prompt": prompt,
                "container": container,
                "command": command,
                "scheduled_at": scheduled_at,
                "created_at": created_at,
                "fired": fired != 0,
            })
        })
        .collect())
}

/// List all saved prompts, ordered by most recently updated.
pub fn list_prompts(conn: &Connection) -> Result<Vec<serde_json::Value>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, title, body, tags, created_at, updated_at
             FROM prompt_library ORDER BY updated_at DESC",
        )
        .context("prepare list_prompts")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, f64>(4)?,
                row.get::<_, f64>(5)?,
            ))
        })
        .context("query list_prompts")?
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("collect list_prompts")?;
    Ok(rows
        .into_iter()
        .map(|(id, title, body, tags, created_at, updated_at)| {
            let parsed_tags: serde_json::Value =
                serde_json::from_str(&tags).unwrap_or(serde_json::json!([]));
            serde_json::json!({
                "id": id,
                "title": title,
                "body": body,
                "tags": parsed_tags,
                "created_at": created_at,
                "updated_at": updated_at,
            })
        })
        .collect())
}

/// Insert a new saved prompt.
pub fn insert_prompt(
    conn: &Connection,
    id: &str,
    title: &str,
    body: &str,
    tags: &str,
    now: f64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO prompt_library (id, title, body, tags, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)",
        rusqlite::params![id, title, body, tags, now],
    )
    .context("insert_prompt failed")?;
    Ok(())
}

/// Update an existing saved prompt.
pub fn update_prompt(
    conn: &Connection,
    id: &str,
    title: &str,
    body: &str,
    tags: &str,
    now: f64,
) -> Result<()> {
    conn.execute(
        "UPDATE prompt_library SET title = ?2, body = ?3, tags = ?4, updated_at = ?5 WHERE id = ?1",
        rusqlite::params![id, title, body, tags, now],
    )
    .context("update_prompt failed")?;
    Ok(())
}

/// Delete a saved prompt by id.
pub fn delete_prompt(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM prompt_library WHERE id = ?1", rusqlite::params![id])
        .context("delete_prompt failed")?;
    Ok(())
}

/// Enforce per-session event cap: drop oldest events beyond 10,000.
pub fn enforce_retention(conn: &Connection) -> Result<()> {
    conn.execute(
        "DELETE FROM events WHERE seq NOT IN (
             SELECT seq FROM events ORDER BY seq DESC LIMIT 10000
         )",
        [],
    )
    .context("enforce_retention")?;
    Ok(())
}

/// Produce a truncation envelope for payloads exceeding 64 KiB.
pub fn truncate_payload(line: &str) -> String {
    let full_size = line.len();
    serde_json::to_string(&serde_json::json!({
        "truncated": true,
        "full_size_bytes": full_size,
    }))
    .unwrap_or_else(|_| r#"{"truncated":true}"#.to_string())
}

fn data_dir() -> Result<std::path::PathBuf> {
    let home = std::env::var("HOME").context("HOME not set")?;
    Ok(std::path::PathBuf::from(home).join(".local/share/navetted"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn in_memory_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS events (
                 seq        INTEGER PRIMARY KEY AUTOINCREMENT,
                 ts         REAL    NOT NULL,
                 json       TEXT    NOT NULL,
                 session_id TEXT    NOT NULL DEFAULT ''
             );
             CREATE TABLE IF NOT EXISTS scheduled_sessions (
                 id           TEXT    PRIMARY KEY,
                 prompt       TEXT    NOT NULL,
                 container    TEXT,
                 command      TEXT,
                 scheduled_at REAL    NOT NULL,
                 created_at   REAL    NOT NULL,
                 fired        INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS prompt_library (
                 id         TEXT    PRIMARY KEY,
                 title      TEXT    NOT NULL,
                 body       TEXT    NOT NULL,
                 tags       TEXT    NOT NULL DEFAULT '[]',
                 created_at REAL    NOT NULL,
                 updated_at REAL    NOT NULL
             );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn insert_and_query_event() {
        let conn = in_memory_db();
        let json = r#"{"type":"test","session_id":"abc"}"#;
        let seq = insert_event(&conn, 1000.0, json).unwrap();
        assert!(seq > 0);

        let rows = events_since(&conn, 0).unwrap();
        assert_eq!(rows.len(), 1);
        let (row_seq, row_ts, row_json) = &rows[0];
        assert_eq!(*row_seq, seq);
        assert_eq!(*row_ts, 1000.0);
        assert_eq!(row_json, json);
    }

    #[test]
    fn events_since_returns_correct_range() {
        let conn = in_memory_db();
        let seq1 = insert_event(&conn, 1.0, r#"{"type":"a","session_id":""}"#).unwrap();
        let seq2 = insert_event(&conn, 2.0, r#"{"type":"b","session_id":""}"#).unwrap();
        let seq3 = insert_event(&conn, 3.0, r#"{"type":"c","session_id":""}"#).unwrap();

        // since=seq1 should return seq2 and seq3 only
        let rows = events_since(&conn, seq1).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].0, seq2);
        assert_eq!(rows[1].0, seq3);
    }

    #[test]
    fn events_since_zero_returns_all() {
        let conn = in_memory_db();
        insert_event(&conn, 1.0, r#"{"type":"a","session_id":""}"#).unwrap();
        insert_event(&conn, 2.0, r#"{"type":"b","session_id":""}"#).unwrap();

        let rows = events_since(&conn, 0).unwrap();
        assert_eq!(rows.len(), 2);
    }

    #[test]
    fn head_seq_returns_zero_when_empty() {
        let conn = in_memory_db();
        let seq = head_seq(&conn).unwrap();
        assert_eq!(seq, 0);
    }

    #[test]
    fn head_seq_returns_highest_seq() {
        let conn = in_memory_db();
        insert_event(&conn, 1.0, r#"{"type":"a","session_id":""}"#).unwrap();
        let last = insert_event(&conn, 2.0, r#"{"type":"b","session_id":""}"#).unwrap();
        assert_eq!(head_seq(&conn).unwrap(), last);
    }

    #[test]
    fn scheduled_session_lifecycle() {
        let conn = in_memory_db();

        insert_scheduled_session(&conn, "id-1", "run tests", None, None, 9000.0, 8000.0).unwrap();

        // Pending should return the session
        let pending = get_pending_scheduled_sessions(&conn).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0]["id"], "id-1");
        assert_eq!(pending[0]["fired"], false);

        // Mark it fired
        mark_scheduled_session_fired(&conn, "id-1").unwrap();

        // Pending should now be empty
        let pending_after = get_pending_scheduled_sessions(&conn).unwrap();
        assert_eq!(pending_after.len(), 0);

        // list_scheduled_sessions still shows it, but fired=true
        let all = list_scheduled_sessions(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0]["fired"], true);
    }

    #[test]
    fn delete_scheduled_session_removes_it() {
        let conn = in_memory_db();
        insert_scheduled_session(&conn, "id-del", "delete me", None, None, 1000.0, 900.0).unwrap();
        delete_scheduled_session(&conn, "id-del").unwrap();
        let all = list_scheduled_sessions(&conn).unwrap();
        assert_eq!(all.len(), 0);
    }

    #[test]
    fn get_session_list_groups_by_session_id() {
        let conn = in_memory_db();

        insert_event(&conn, 1.0, r#"{"type":"a","session_id":"sess-1"}"#).unwrap();
        insert_event(&conn, 2.0, r#"{"type":"b","session_id":"sess-1"}"#).unwrap();
        insert_event(&conn, 3.0, r#"{"type":"c","session_id":"sess-2"}"#).unwrap();

        let sessions = get_session_list(&conn).unwrap();
        assert_eq!(sessions.len(), 2);

        // Both session IDs should appear
        let ids: Vec<&str> = sessions
            .iter()
            .map(|v| v["session_id"].as_str().unwrap())
            .collect();
        assert!(ids.contains(&"sess-1"));
        assert!(ids.contains(&"sess-2"));
    }

    #[test]
    fn get_session_events_returns_only_matching_session() {
        let conn = in_memory_db();
        insert_event(&conn, 1.0, r#"{"type":"a","session_id":"sess-A"}"#).unwrap();
        insert_event(&conn, 2.0, r#"{"type":"b","session_id":"sess-B"}"#).unwrap();
        insert_event(&conn, 3.0, r#"{"type":"c","session_id":"sess-A"}"#).unwrap();

        let events = get_session_events(&conn, "sess-A").unwrap();
        assert_eq!(events.len(), 2);
        for ev in &events {
            let inner = &ev["event"];
            assert_eq!(inner["session_id"], "sess-A");
        }
    }

    #[test]
    fn truncate_payload_produces_valid_json() {
        let large = "x".repeat(100);
        let result = truncate_payload(&large);
        let v: serde_json::Value = serde_json::from_str(&result).unwrap();
        assert_eq!(v["truncated"], true);
        assert_eq!(v["full_size_bytes"], 100);
    }

    #[test]
    fn enforce_retention_does_not_fail_on_small_table() {
        let conn = in_memory_db();
        insert_event(&conn, 1.0, r#"{"type":"a","session_id":""}"#).unwrap();
        // Should succeed without error even with fewer than 10_000 rows
        enforce_retention(&conn).unwrap();
        let rows = events_since(&conn, 0).unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[test]
    fn prompt_library_crud() {
        let conn = in_memory_db();

        insert_prompt(&conn, "p1", "Fix tests", "cargo test --all", "[]", 1000.0).unwrap();
        insert_prompt(&conn, "p2", "Deploy", "cargo build --release", r#"["ops"]"#, 2000.0).unwrap();

        let all = list_prompts(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0]["id"], "p2");
        assert_eq!(all[1]["id"], "p1");

        update_prompt(&conn, "p1", "Fix all tests", "cargo test", r#"["dev"]"#, 3000.0).unwrap();
        let updated = list_prompts(&conn).unwrap();
        assert_eq!(updated[0]["id"], "p1");
        assert_eq!(updated[0]["title"], "Fix all tests");
        assert_eq!(updated[0]["tags"], serde_json::json!(["dev"]));

        delete_prompt(&conn, "p2").unwrap();
        let after_delete = list_prompts(&conn).unwrap();
        assert_eq!(after_delete.len(), 1);
        assert_eq!(after_delete[0]["id"], "p1");
    }
}
