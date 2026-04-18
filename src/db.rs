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
    tracing::info!("DB opened at {}", db_path.display());
    Ok(conn)
}

/// Insert one event. Returns the assigned seq number.
pub fn insert_event(conn: &Connection, ts: f64, json: &str) -> Result<i64> {
    conn.execute(
        "INSERT INTO events (ts, json) VALUES (?1, ?2)",
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
