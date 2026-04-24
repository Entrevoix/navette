// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

use std::os::unix::fs::PermissionsExt;

use anyhow::{Context, Result};
use rand::Rng;
use ring::aead::{Aad, LessSafeKey, Nonce, UnboundKey, AES_256_GCM};
use ring::hkdf;
use rusqlite::Connection;

const HKDF_SALT: &[u8] = b"navetted-secrets-v1";

struct AesKeyLen;
impl hkdf::KeyType for AesKeyLen {
    fn len(&self) -> usize {
        32
    }
}

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
         );
         CREATE TABLE IF NOT EXISTS secrets (
             name       TEXT    PRIMARY KEY,
             encrypted  BLOB    NOT NULL,
             nonce      BLOB    NOT NULL,
             created_at REAL    NOT NULL,
             updated_at REAL    NOT NULL
         );
         CREATE TABLE IF NOT EXISTS devices (
             device_id  TEXT    PRIMARY KEY,
             name       TEXT    NOT NULL,
             paired_at  REAL    NOT NULL,
             last_seen  REAL    NOT NULL,
             revoked    INTEGER NOT NULL DEFAULT 0
         );
         CREATE TABLE IF NOT EXISTS approval_policy (
             tool_name  TEXT    PRIMARY KEY,
             action     TEXT    NOT NULL DEFAULT 'prompt',
             created_at REAL    NOT NULL,
             updated_at REAL    NOT NULL
         );",
    )
    .context("failed to initialize schema")?;
    // Migration: add session_id column for multi-session support (idempotent).
    match conn.execute(
        "ALTER TABLE events ADD COLUMN session_id TEXT NOT NULL DEFAULT ''",
        [],
    ) {
        Ok(_) => {}
        Err(rusqlite::Error::SqliteFailure(err, Some(ref msg)))
            if err.extended_code == 1 && msg.contains("duplicate column") => {}
        Err(e) => {
            tracing::warn!("migration failed: {e}");
        }
    }
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
    conn.query_row("SELECT COALESCE(MAX(seq), 0) FROM events", [], |r| r.get(0))
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
        .map(
            |(id, prompt, container, command, scheduled_at, created_at)| {
                serde_json::json!({
                    "id": id,
                    "prompt": prompt,
                    "container": container,
                    "command": command,
                    "scheduled_at": scheduled_at,
                    "created_at": created_at,
                    "fired": false,
                })
            },
        )
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
        .map(
            |(id, prompt, container, command, scheduled_at, created_at, fired)| {
                serde_json::json!({
                    "id": id,
                    "prompt": prompt,
                    "container": container,
                    "command": command,
                    "scheduled_at": scheduled_at,
                    "created_at": created_at,
                    "fired": fired != 0,
                })
            },
        )
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
    conn.execute(
        "DELETE FROM prompt_library WHERE id = ?1",
        rusqlite::params![id],
    )
    .context("delete_prompt failed")?;
    Ok(())
}

// ── Secrets vault (AES-256-GCM encrypted at rest) ────────────────────────────

const VAULT_KEY_FILE: &str = "vault.key";
const VAULT_KEY_LEN: usize = 32;

/// Load the standalone vault key from disk, or generate one if it doesn't exist.
/// The key file is stored at `~/.local/share/navetted/vault.key` with 0600 perms.
pub fn load_or_create_vault_key() -> Result<LessSafeKey> {
    load_or_create_vault_key_at(&data_dir()?.join(VAULT_KEY_FILE))
}

fn load_or_create_vault_key_at(path: &std::path::Path) -> Result<LessSafeKey> {
    let key_bytes = if path.exists() {
        let bytes = std::fs::read(path)
            .with_context(|| format!("failed to read vault key at {}", path.display()))?;
        anyhow::ensure!(
            bytes.len() == VAULT_KEY_LEN,
            "vault.key has wrong length ({})",
            bytes.len()
        );
        let mut arr = [0u8; VAULT_KEY_LEN];
        arr.copy_from_slice(&bytes);
        arr
    } else {
        let mut key = [0u8; VAULT_KEY_LEN];
        rand::thread_rng().fill(&mut key[..]);
        std::fs::create_dir_all(path.parent().unwrap())
            .context("failed to create data dir for vault key")?;
        std::fs::write(path, key)
            .with_context(|| format!("failed to write vault key to {}", path.display()))?;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))
            .with_context(|| format!("failed to set permissions on {}", path.display()))?;
        tracing::info!("generated new vault key at {}", path.display());
        key
    };
    let unbound = UnboundKey::new(&AES_256_GCM, &key_bytes)
        .map_err(|_| anyhow::anyhow!("AES key construction failed"))?;
    Ok(LessSafeKey::new(unbound))
}

/// Migrate secrets from the old HKDF-from-token key to the standalone vault key.
/// No-op if vault.key already existed before this call (migration already done)
/// or if no secrets exist.
pub fn migrate_vault_if_needed(conn: &Connection, token: &str) -> Result<()> {
    migrate_vault_if_needed_at(conn, token, &data_dir()?.join(VAULT_KEY_FILE))
}

#[allow(deprecated)]
fn migrate_vault_if_needed_at(
    conn: &Connection,
    token: &str,
    vault_path: &std::path::Path,
) -> Result<()> {
    let vault_existed = vault_path.exists();

    let new_key = load_or_create_vault_key_at(vault_path)?;

    if vault_existed {
        return Ok(());
    }

    let names = list_secrets(conn)?;
    if names.is_empty() {
        tracing::info!("no existing secrets to migrate");
        return Ok(());
    }

    let old_key = derive_secret_key(token)?;

    tracing::info!(
        count = names.len(),
        "migrating secrets from token-derived key to vault key"
    );

    let tx = conn
        .unchecked_transaction()
        .context("failed to begin migration transaction")?;

    for (name, _, _) in &names {
        let (enc, non) = match get_secret_encrypted(&tx, name)? {
            Some(pair) => pair,
            None => continue,
        };
        let plaintext = decrypt_secret(&old_key, &enc, &non)
            .with_context(|| format!("failed to decrypt secret '{name}' with old key"))?;
        let (new_enc, new_nonce) = encrypt_secret(&new_key, &plaintext)?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64();
        tx.execute(
            "UPDATE secrets SET encrypted = ?2, nonce = ?3, updated_at = ?4 WHERE name = ?1",
            rusqlite::params![name, new_enc, new_nonce.as_slice(), now],
        )
        .with_context(|| format!("failed to re-encrypt secret '{name}'"))?;
    }

    tx.commit()
        .context("failed to commit migration transaction")?;

    tracing::info!(count = names.len(), "vault migration complete");
    Ok(())
}

#[deprecated(note = "use load_or_create_vault_key instead")]
pub fn derive_secret_key(token: &str) -> Result<LessSafeKey> {
    let salt = hkdf::Salt::new(hkdf::HKDF_SHA256, HKDF_SALT);
    let prk = salt.extract(token.as_bytes());
    let okm = prk
        .expand(&[b"aes-256-gcm-key"], AesKeyLen)
        .map_err(|_| anyhow::anyhow!("HKDF expand failed"))?;
    let mut key_bytes = [0u8; 32];
    okm.fill(&mut key_bytes)
        .map_err(|_| anyhow::anyhow!("HKDF fill failed"))?;
    let unbound = UnboundKey::new(&AES_256_GCM, &key_bytes)
        .map_err(|_| anyhow::anyhow!("AES key construction failed"))?;
    Ok(LessSafeKey::new(unbound))
}

pub fn encrypt_secret(key: &LessSafeKey, plaintext: &[u8]) -> Result<(Vec<u8>, [u8; 12])> {
    let mut nonce_bytes = [0u8; 12];
    rand::thread_rng().fill(&mut nonce_bytes[..]);
    let nonce = Nonce::assume_unique_for_key(nonce_bytes);
    let mut in_out = plaintext.to_vec();
    key.seal_in_place_append_tag(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| anyhow::anyhow!("encryption failed"))?;
    Ok((in_out, nonce_bytes))
}

pub fn decrypt_secret(key: &LessSafeKey, ciphertext: &[u8], nonce_bytes: &[u8]) -> Result<Vec<u8>> {
    let nonce = Nonce::try_assume_unique_for_key(nonce_bytes)
        .map_err(|_| anyhow::anyhow!("invalid nonce length"))?;
    let mut in_out = ciphertext.to_vec();
    let plaintext = key
        .open_in_place(nonce, Aad::empty(), &mut in_out)
        .map_err(|_| anyhow::anyhow!("decryption failed — wrong key or corrupted data"))?;
    Ok(plaintext.to_vec())
}

pub fn list_secrets(conn: &Connection) -> Result<Vec<(String, f64, f64)>> {
    let mut stmt = conn
        .prepare("SELECT name, created_at, updated_at FROM secrets ORDER BY name")
        .context("prepare list_secrets")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, f64>(1)?,
                row.get::<_, f64>(2)?,
            ))
        })
        .context("query list_secrets")?
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("collect list_secrets")?;
    Ok(rows)
}

pub fn get_secret_encrypted(conn: &Connection, name: &str) -> Result<Option<(Vec<u8>, Vec<u8>)>> {
    match conn.query_row(
        "SELECT encrypted, nonce FROM secrets WHERE name = ?1",
        rusqlite::params![name],
        |row| Ok((row.get::<_, Vec<u8>>(0)?, row.get::<_, Vec<u8>>(1)?)),
    ) {
        Ok(pair) => Ok(Some(pair)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e).context("get_secret_encrypted failed"),
    }
}

pub fn set_secret(
    conn: &Connection,
    name: &str,
    encrypted: &[u8],
    nonce: &[u8],
    now: f64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO secrets (name, encrypted, nonce, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(name) DO UPDATE SET encrypted = excluded.encrypted, nonce = excluded.nonce, updated_at = excluded.updated_at",
        rusqlite::params![name, encrypted, nonce, now],
    )
    .context("set_secret failed")?;
    Ok(())
}

pub fn delete_secret(conn: &Connection, name: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM secrets WHERE name = ?1",
        rusqlite::params![name],
    )
    .context("delete_secret failed")?;
    Ok(())
}

// ── Device management ────────────────────────────────────────────────────────

pub fn upsert_device(conn: &Connection, device_id: &str, name: &str, now: f64) -> Result<()> {
    conn.execute(
        "INSERT INTO devices (device_id, name, paired_at, last_seen)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(device_id) DO UPDATE SET last_seen = excluded.last_seen",
        rusqlite::params![device_id, name, now],
    )
    .context("upsert_device failed")?;
    Ok(())
}

pub fn is_device_revoked(conn: &Connection, device_id: &str) -> Result<bool> {
    match conn.query_row(
        "SELECT revoked FROM devices WHERE device_id = ?1",
        rusqlite::params![device_id],
        |row| row.get::<_, i32>(0),
    ) {
        Ok(v) => Ok(v != 0),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(false),
        Err(e) => Err(e).context("is_device_revoked failed"),
    }
}

pub fn list_devices(conn: &Connection) -> Result<Vec<serde_json::Value>> {
    let mut stmt = conn
        .prepare("SELECT device_id, name, paired_at, last_seen, revoked FROM devices ORDER BY last_seen DESC")
        .context("prepare list_devices")?;
    let rows = stmt
        .query_map([], |row| {
            Ok(serde_json::json!({
                "device_id": row.get::<_, String>(0)?,
                "name": row.get::<_, String>(1)?,
                "paired_at": row.get::<_, f64>(2)?,
                "last_seen": row.get::<_, f64>(3)?,
                "revoked": row.get::<_, i32>(4)? != 0,
            }))
        })
        .context("query list_devices")?
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("collect list_devices")?;
    Ok(rows)
}

pub fn set_device_revoked(conn: &Connection, device_id: &str, revoked: bool) -> Result<()> {
    conn.execute(
        "UPDATE devices SET revoked = ?1 WHERE device_id = ?2",
        rusqlite::params![revoked as i32, device_id],
    )
    .context("set_device_revoked failed")?;
    Ok(())
}

pub fn rename_device(conn: &Connection, device_id: &str, new_name: &str) -> Result<()> {
    conn.execute(
        "UPDATE devices SET name = ?1 WHERE device_id = ?2",
        rusqlite::params![new_name, device_id],
    )
    .context("rename_device failed")?;
    Ok(())
}

// ── Approval policy ──────────────────────────────────────────────────────────

pub fn list_approval_policies(conn: &Connection) -> Result<Vec<(String, String, f64, f64)>> {
    let mut stmt = conn
        .prepare(
            "SELECT tool_name, action, created_at, updated_at \
             FROM approval_policy ORDER BY tool_name",
        )
        .context("prepare list_approval_policies")?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, f64>(3)?,
            ))
        })
        .context("query list_approval_policies")?
        .collect::<std::result::Result<Vec<_>, _>>()
        .context("collect list_approval_policies")?;
    Ok(rows)
}

pub fn get_approval_policy(conn: &Connection, tool_name: &str) -> Result<Option<String>> {
    match conn.query_row(
        "SELECT action FROM approval_policy WHERE tool_name = ?1",
        rusqlite::params![tool_name],
        |row| row.get::<_, String>(0),
    ) {
        Ok(action) => Ok(Some(action)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e).context("get_approval_policy failed"),
    }
}

pub fn set_approval_policy(
    conn: &Connection,
    tool_name: &str,
    action: &str,
    now: f64,
) -> Result<()> {
    conn.execute(
        "INSERT INTO approval_policy (tool_name, action, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(tool_name) DO UPDATE SET
             action = excluded.action,
             updated_at = excluded.updated_at",
        rusqlite::params![tool_name, action, now],
    )
    .context("set_approval_policy failed")?;
    Ok(())
}

pub fn delete_approval_policy(conn: &Connection, tool_name: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM approval_policy WHERE tool_name = ?1",
        rusqlite::params![tool_name],
    )
    .context("delete_approval_policy failed")?;
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
             );
             CREATE TABLE IF NOT EXISTS secrets (
                 name       TEXT    PRIMARY KEY,
                 encrypted  BLOB    NOT NULL,
                 nonce      BLOB    NOT NULL,
                 created_at REAL    NOT NULL,
                 updated_at REAL    NOT NULL
             );
             CREATE TABLE IF NOT EXISTS devices (
                 device_id  TEXT    PRIMARY KEY,
                 name       TEXT    NOT NULL,
                 paired_at  REAL    NOT NULL,
                 last_seen  REAL    NOT NULL,
                 revoked    INTEGER NOT NULL DEFAULT 0
             );
             CREATE TABLE IF NOT EXISTS approval_policy (
                 tool_name  TEXT    PRIMARY KEY,
                 action     TEXT    NOT NULL DEFAULT 'prompt',
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
        insert_prompt(
            &conn,
            "p2",
            "Deploy",
            "cargo build --release",
            r#"["ops"]"#,
            2000.0,
        )
        .unwrap();

        let all = list_prompts(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0]["id"], "p2");
        assert_eq!(all[1]["id"], "p1");

        update_prompt(
            &conn,
            "p1",
            "Fix all tests",
            "cargo test",
            r#"["dev"]"#,
            3000.0,
        )
        .unwrap();
        let updated = list_prompts(&conn).unwrap();
        assert_eq!(updated[0]["id"], "p1");
        assert_eq!(updated[0]["title"], "Fix all tests");
        assert_eq!(updated[0]["tags"], serde_json::json!(["dev"]));

        delete_prompt(&conn, "p2").unwrap();
        let after_delete = list_prompts(&conn).unwrap();
        assert_eq!(after_delete.len(), 1);
        assert_eq!(after_delete[0]["id"], "p1");
    }

    #[allow(deprecated)]
    #[test]
    fn secret_encrypt_decrypt_roundtrip() {
        let conn = in_memory_db();
        let key = derive_secret_key("test-token-32chars-1234567890ab").unwrap();

        let plaintext = b"my-secret-api-key-12345";
        let (encrypted, nonce) = encrypt_secret(&key, plaintext).unwrap();

        set_secret(&conn, "GITHUB_TOKEN", &encrypted, &nonce, 1000.0).unwrap();

        let secrets = list_secrets(&conn).unwrap();
        assert_eq!(secrets.len(), 1);
        assert_eq!(secrets[0].0, "GITHUB_TOKEN");

        let (enc, non) = get_secret_encrypted(&conn, "GITHUB_TOKEN")
            .unwrap()
            .unwrap();
        let decrypted = decrypt_secret(&key, &enc, &non).unwrap();
        assert_eq!(decrypted, plaintext);

        delete_secret(&conn, "GITHUB_TOKEN").unwrap();
        assert_eq!(list_secrets(&conn).unwrap().len(), 0);
    }

    #[allow(deprecated)]
    #[test]
    fn secret_upsert_updates_value() {
        let conn = in_memory_db();
        let key = derive_secret_key("test-token-32chars-1234567890ab").unwrap();

        let (enc1, non1) = encrypt_secret(&key, b"old-value").unwrap();
        set_secret(&conn, "MY_KEY", &enc1, &non1, 1000.0).unwrap();

        let (enc2, non2) = encrypt_secret(&key, b"new-value").unwrap();
        set_secret(&conn, "MY_KEY", &enc2, &non2, 2000.0).unwrap();

        let secrets = list_secrets(&conn).unwrap();
        assert_eq!(secrets.len(), 1);

        let (enc, non) = get_secret_encrypted(&conn, "MY_KEY").unwrap().unwrap();
        let decrypted = decrypt_secret(&key, &enc, &non).unwrap();
        assert_eq!(decrypted, b"new-value");
    }

    #[test]
    fn vault_key_roundtrip() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_path = tmp.path().join("vault.key");

        let key1 = load_or_create_vault_key_at(&vault_path).unwrap();
        let plaintext = b"vault-key-test-secret";
        let (enc, nonce) = encrypt_secret(&key1, plaintext).unwrap();

        let key2 = load_or_create_vault_key_at(&vault_path).unwrap();
        let decrypted = decrypt_secret(&key2, &enc, &nonce).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[allow(deprecated)]
    #[test]
    fn vault_migration_re_encrypts_secrets() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_path = tmp.path().join("vault.key");

        let conn = in_memory_db();
        let token = "migration-test-token-1234567890ab";
        let old_key = derive_secret_key(token).unwrap();

        let (enc, nonce) = encrypt_secret(&old_key, b"my-secret").unwrap();
        set_secret(&conn, "API_KEY", &enc, &nonce, 1000.0).unwrap();

        migrate_vault_if_needed_at(&conn, token, &vault_path).unwrap();

        let new_key = load_or_create_vault_key_at(&vault_path).unwrap();
        let (enc2, non2) = get_secret_encrypted(&conn, "API_KEY").unwrap().unwrap();
        let decrypted = decrypt_secret(&new_key, &enc2, &non2).unwrap();
        assert_eq!(decrypted, b"my-secret");

        assert!(decrypt_secret(&old_key, &enc2, &non2).is_err());
    }

    #[allow(deprecated)]
    #[test]
    fn vault_migration_is_idempotent() {
        let tmp = tempfile::tempdir().unwrap();
        let vault_path = tmp.path().join("vault.key");

        let conn = in_memory_db();
        let token = "idempotent-test-token-1234567890";
        let old_key = derive_secret_key(token).unwrap();

        let (enc, nonce) = encrypt_secret(&old_key, b"secret-val").unwrap();
        set_secret(&conn, "KEY1", &enc, &nonce, 1000.0).unwrap();

        migrate_vault_if_needed_at(&conn, token, &vault_path).unwrap();
        migrate_vault_if_needed_at(&conn, token, &vault_path).unwrap();

        let new_key = load_or_create_vault_key_at(&vault_path).unwrap();
        let (enc2, non2) = get_secret_encrypted(&conn, "KEY1").unwrap().unwrap();
        let decrypted = decrypt_secret(&new_key, &enc2, &non2).unwrap();
        assert_eq!(decrypted, b"secret-val");
    }

    #[test]
    fn secret_not_found_returns_none() {
        let conn = in_memory_db();
        assert!(get_secret_encrypted(&conn, "NONEXISTENT")
            .unwrap()
            .is_none());
    }

    #[allow(deprecated)]
    #[test]
    fn secret_wrong_key_fails_decrypt() {
        let key1 = derive_secret_key("token-one-1234567890123456789012").unwrap();
        let key2 = derive_secret_key("token-two-1234567890123456789012").unwrap();

        let (encrypted, nonce) = encrypt_secret(&key1, b"secret-data").unwrap();
        assert!(decrypt_secret(&key2, &encrypted, &nonce).is_err());
    }

    #[test]
    fn upsert_device_creates_and_updates() {
        let conn = in_memory_db();
        upsert_device(&conn, "dev-1", "My iPhone", 1000.0).unwrap();

        let devices = list_devices(&conn).unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0]["device_id"], "dev-1");
        assert_eq!(devices[0]["name"], "My iPhone");
        assert_eq!(devices[0]["paired_at"], 1000.0);
        assert_eq!(devices[0]["last_seen"], 1000.0);

        upsert_device(&conn, "dev-1", "My iPhone", 2000.0).unwrap();

        let devices = list_devices(&conn).unwrap();
        assert_eq!(devices.len(), 1);
        assert_eq!(devices[0]["paired_at"], 1000.0);
        assert_eq!(devices[0]["last_seen"], 2000.0);
    }

    #[test]
    fn revoke_device_blocks_lookup() {
        let conn = in_memory_db();
        upsert_device(&conn, "dev-r", "Revokable", 1000.0).unwrap();
        assert!(!is_device_revoked(&conn, "dev-r").unwrap());

        set_device_revoked(&conn, "dev-r", true).unwrap();
        assert!(is_device_revoked(&conn, "dev-r").unwrap());

        set_device_revoked(&conn, "dev-r", false).unwrap();
        assert!(!is_device_revoked(&conn, "dev-r").unwrap());
    }

    #[test]
    fn rename_device_works() {
        let conn = in_memory_db();
        upsert_device(&conn, "dev-n", "Old Name", 1000.0).unwrap();
        rename_device(&conn, "dev-n", "New Name").unwrap();

        let devices = list_devices(&conn).unwrap();
        assert_eq!(devices[0]["name"], "New Name");
    }

    #[test]
    fn list_devices_returns_all() {
        let conn = in_memory_db();
        upsert_device(&conn, "d1", "Phone", 3000.0).unwrap();
        upsert_device(&conn, "d2", "Tablet", 2000.0).unwrap();
        upsert_device(&conn, "d3", "Laptop", 1000.0).unwrap();

        let devices = list_devices(&conn).unwrap();
        assert_eq!(devices.len(), 3);
        assert_eq!(devices[0]["device_id"], "d1");
        assert_eq!(devices[1]["device_id"], "d2");
        assert_eq!(devices[2]["device_id"], "d3");
    }

    #[test]
    fn unknown_device_not_revoked() {
        let conn = in_memory_db();
        assert!(!is_device_revoked(&conn, "nonexistent").unwrap());
    }

    #[test]
    fn approval_policy_crud() {
        let conn = in_memory_db();
        assert!(get_approval_policy(&conn, "Bash").unwrap().is_none());
        set_approval_policy(&conn, "Read", "allow", 1000.0).unwrap();
        assert_eq!(
            get_approval_policy(&conn, "Read").unwrap(),
            Some("allow".to_string())
        );
        set_approval_policy(&conn, "Read", "deny", 2000.0).unwrap();
        assert_eq!(
            get_approval_policy(&conn, "Read").unwrap(),
            Some("deny".to_string())
        );
        set_approval_policy(&conn, "Write", "prompt", 1000.0).unwrap();
        let all = list_approval_policies(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].0, "Read");
        assert_eq!(all[1].0, "Write");
        delete_approval_policy(&conn, "Read").unwrap();
        assert!(get_approval_policy(&conn, "Read").unwrap().is_none());
    }
}
