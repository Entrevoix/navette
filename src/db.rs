use anyhow::{Context, Result};
use rusqlite::Connection;

pub fn open() -> Result<Connection> {
    let data_dir = data_dir()?;
    std::fs::create_dir_all(&data_dir)
        .with_context(|| format!("failed to create data dir {}", data_dir.display()))?;
    let db_path = data_dir.join("events.db");
    let conn = Connection::open(&db_path)
        .with_context(|| format!("failed to open DB at {}", db_path.display()))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE IF NOT EXISTS events (
             seq  INTEGER PRIMARY KEY AUTOINCREMENT,
             ts   REAL    NOT NULL,
             json TEXT    NOT NULL
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
    Ok(std::path::PathBuf::from(home).join(".local/share/clauded"))
}
