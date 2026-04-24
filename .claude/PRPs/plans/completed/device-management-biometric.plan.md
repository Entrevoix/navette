# Plan: Device Management + Biometric Token Protection

## Summary
Add device tracking to the navetted daemon so users can see which devices are paired, when they last connected, and revoke access per-device. On the mobile side, move the auth token into `expo-secure-store` with biometric protection so the token can't be accessed without Face ID / fingerprint — the existing LockScreen already has this infrastructure.

## User Story
As a navette user, I want to see which devices are paired to my daemon and revoke any I don't recognize, so that I can control access to my workstation. I also want the auth token locked behind biometrics so a stolen phone can't connect without my face/fingerprint.

## Problem -> Solution
Currently any device with the token has permanent, invisible access. No audit trail, no revocation, no biometric gate on the token itself. -> Daemon tracks devices with last-seen timestamps, supports per-device revocation, and the mobile app stores the token in biometric-protected secure storage.

## Metadata
- **Complexity**: Medium
- **Source PRD**: N/A
- **PRD Phase**: Phase 4 of auth pairing plan
- **Estimated Files**: 8 (4 Rust, 4 React Native)

---

## UX Design

### Before
N/A — no device visibility exists. Token stored in plaintext on device.

### After
```
Settings > Paired Devices
+----------------------------------+
| My iPhone           just now   * |
| Work iPad        2 hours ago     |
| Old Phone (revoked)              |
+----------------------------------+
[Rename]  [Revoke]
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Settings | No device section | "Paired Devices" row opens DevicesScreen | |
| Auth flow | Token sent immediately | Token released only after biometric | LockScreen already exists |
| ConnectScreen | Token stored in state/AsyncStorage | Token stored in SecureStore | Biometric-protected |
| Revoked device connects | Accepted | Rejected with "device revoked" | Before welcome |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/db.rs` | 21-71 | Schema creation pattern in open() |
| P0 | `src/db.rs` | 490-544 | CRUD pattern (list/set/delete secrets) |
| P0 | `src/ws.rs` | 97-162 | Auth phase — insertion point for revocation |
| P0 | `src/ws.rs` | 763-873 | WS command handler pattern |
| P1 | `mobile/src/hooks/useNavettedWS.ts` | 260-276 | Command dispatch pattern |
| P1 | `mobile/src/hooks/useNavettedWS.ts` | 419-600 | Message handler pattern |
| P1 | `mobile/src/screens/LockScreen.tsx` | 37-96 | Existing biometric + PIN + SecureStore |
| P1 | `mobile/src/screens/SettingsScreen.tsx` | 64-410 | Settings section pattern |
| P2 | `mobile/src/screens/SecretsScreen.tsx` | all | Closest analogy for list + actions screen |

---

## Patterns to Mirror

### DB_CRUD_LIST
```rust
// SOURCE: src/db.rs:490-506
pub fn list_secrets(conn: &Connection) -> Result<Vec<(String, f64, f64)>> {
    let mut stmt = conn.prepare("SELECT name, created_at, updated_at FROM secrets ORDER BY name")
        .context("prepare list_secrets")?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?, row.get::<_, f64>(2)?))
    }).context("query list_secrets")?
    .collect::<std::result::Result<Vec<_>, _>>()
    .context("collect list_secrets")?;
    Ok(rows)
}
```

### DB_UPSERT
```rust
// SOURCE: src/db.rs:520-535
conn.execute(
    "INSERT INTO secrets (name, ...) VALUES (?1, ...)
     ON CONFLICT(name) DO UPDATE SET ... = excluded....",
    rusqlite::params![...],
).context("set_secret failed")?;
```

### DB_DELETE
```rust
// SOURCE: src/db.rs:537-544
pub fn delete_secret(conn: &Connection, name: &str) -> Result<()> {
    conn.execute("DELETE FROM secrets WHERE name = ?1", rusqlite::params![name])
        .context("delete_secret failed")?;
    Ok(())
}
```

### WS_HANDLER_WITH_DB
```rust
// SOURCE: src/ws.rs:859-873 (delete_secret pattern — simple, no spawn_blocking)
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
    })).unwrap_or_default();
    if sink.send(Message::Text(reply)).await.is_err() { break; }
}
```

### WS_HANDLER_SPAWN_BLOCKING
```rust
// SOURCE: src/ws.rs:763-803 (list_secrets — spawn_blocking for heavier ops)
let db2 = db.clone();
let result = tokio::task::spawn_blocking(move || {
    let conn = db2.lock().unwrap();
    // ... DB operations ...
    Ok::<_, anyhow::Error>(out)
}).await.context("spawn_blocking panicked")?.unwrap_or_default();
```

### MOBILE_COMMAND
```typescript
// SOURCE: mobile/src/hooks/useNavettedWS.ts:260-276
const listSecrets = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'list_secrets' }));
    }
}, []);
```

### MOBILE_HANDLER
```typescript
// SOURCE: mobile/src/hooks/useNavettedWS.ts:535-545
if (msgType === 'secrets_list') {
    setSecrets((msg['secrets'] as SecretEntry[] | undefined) ?? []);
    return;
}
if (msgType === 'secret_saved' || msgType === 'secret_deleted') {
    wsRef.current.send(JSON.stringify({ type: 'list_secrets' }));
    return;
}
```

### MOBILE_BIOMETRIC
```typescript
// SOURCE: mobile/src/screens/LockScreen.tsx:37-60
const hasHardware = await LocalAuthentication.hasHardwareAsync();
const isEnrolled = await LocalAuthentication.isEnrolledAsync();
if (hasHardware && isEnrolled) {
    const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock navette',
        cancelLabel: 'Use PIN',
        disableDeviceFallback: true,
    });
    if (result.success) { onUnlock(); }
}
```

### MOBILE_SECURE_STORE
```typescript
// SOURCE: mobile/src/screens/LockScreen.tsx:26-34
await SecureStore.setItemAsync(PIN_KEY, pinValue);
const stored = await SecureStore.getItemAsync(PIN_KEY);
```

### TEST_PATTERN
```rust
// SOURCE: src/db.rs:580-616
fn in_memory_db() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("CREATE TABLE IF NOT EXISTS ...").unwrap();
    conn
}
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/db.rs` | UPDATE | Add devices table + CRUD functions + tests |
| `src/ws.rs` | UPDATE | Revocation check in auth, 3 new WS commands |
| `mobile/src/hooks/useNavettedWS.ts` | UPDATE | Add device command dispatchers + handlers |
| `mobile/src/screens/DevicesScreen.tsx` | CREATE | New screen for listing/managing devices |
| `mobile/src/screens/SettingsScreen.tsx` | UPDATE | Add "Paired Devices" row |
| `mobile/src/screens/ConnectScreen.tsx` | UPDATE | Store token in SecureStore after pairing |

## NOT Building

- Device-to-device communication
- Remote wipe
- Push notification on new device pairing (can follow later)
- Automatic device naming from user-agent parsing
- Expiring device sessions / auto-revocation after N days

---

## Step-by-Step Tasks

### Task 1: Add `devices` table to schema
- **ACTION**: Add CREATE TABLE to `db::open()` execute_batch
- **IMPLEMENT**: `CREATE TABLE IF NOT EXISTS devices (device_id TEXT PRIMARY KEY, name TEXT NOT NULL, paired_at REAL NOT NULL, last_seen REAL NOT NULL, revoked INTEGER NOT NULL DEFAULT 0)`
- **MIRROR**: DB schema pattern in `open()` lines 31-61
- **GOTCHA**: Must also add this table to `in_memory_db()` test helper
- **VALIDATE**: `cargo build`

### Task 2: Add device CRUD functions to `db.rs`
- **ACTION**: Add 5 public functions
- **IMPLEMENT**:
  - `upsert_device(conn, device_id, name, now)` — INSERT ON CONFLICT update last_seen only (preserve paired_at)
  - `is_device_revoked(conn, device_id) -> Result<bool>` — SELECT revoked WHERE device_id, return false if not found
  - `list_devices(conn) -> Result<Vec<Value>>` — SELECT all, return as JSON values
  - `set_device_revoked(conn, device_id, revoked: bool) -> Result<()>` — UPDATE revoked flag
  - `rename_device(conn, device_id, new_name) -> Result<()>` — UPDATE name
- **MIRROR**: DB_CRUD_LIST, DB_UPSERT, DB_DELETE
- **IMPORTS**: existing (anyhow, rusqlite, serde_json)
- **GOTCHA**: `is_device_revoked` must return `false` for unknown device_ids (first connection before upsert)
- **VALIDATE**: `cargo build`

### Task 3: Add device tests to `db.rs`
- **ACTION**: Add 4 tests in the existing `#[cfg(test)] mod tests`
- **IMPLEMENT**:
  - `upsert_device_creates_and_updates` — upsert twice, verify paired_at stable, last_seen changes
  - `revoke_device_blocks_lookup` — upsert, set_device_revoked(true), assert is_device_revoked returns true
  - `rename_device_works` — upsert, rename, list, verify name changed
  - `list_devices_returns_all` — insert 3 devices, verify count and fields
- **MIRROR**: TEST_PATTERN
- **VALIDATE**: `cargo test`

### Task 4: Enforce revocation + upsert in auth phase
- **ACTION**: In `ws.rs`, after `client_id` extraction and auth verification, before `welcome`
- **IMPLEMENT**: Lock db, check `is_device_revoked(&conn, &client_id)` — if true, send `rejected("device revoked")` and return. Otherwise `upsert_device(&conn, &client_id, &client_id, unix_ts())`. Drop conn before await.
- **MIRROR**: Lock/drop pattern at ws.rs:155-156
- **GOTCHA**: Must not hold Mutex across `.await` — lock, read, drop, then send
- **VALIDATE**: `cargo build`

### Task 5: Add WS command handlers
- **ACTION**: Add 3 new `else if msg_type` arms in the command dispatch block
- **IMPLEMENT**:
  - `"list_devices"` — lock db, call `db::list_devices`, respond `{"type":"devices_list","devices":[...]}`
  - `"revoke_device"` — extract `device_id`, call `db::set_device_revoked(true)`, respond `{"type":"device_revoked","device_id":"..."}`
  - `"rename_device"` — extract `device_id` + `name`, call `db::rename_device`, respond `{"type":"device_renamed","device_id":"..."}`
- **MIRROR**: WS_HANDLER_WITH_DB (delete_secret pattern)
- **GOTCHA**: Lock/drop pattern, don't hold across await
- **VALIDATE**: `cargo test && cargo clippy -- -D warnings`

### Task 6: Add mobile command dispatchers + handlers
- **ACTION**: Update `useNavettedWS.ts`
- **IMPLEMENT**:
  - Add `devices` state: `const [devices, setDevices] = useState<DeviceEntry[]>([])`
  - Add `DeviceEntry` type: `{ device_id: string; name: string; paired_at: number; last_seen: number; revoked: boolean }`
  - Add `listDevices`, `revokeDevice(deviceId)`, `renameDevice(deviceId, name)` command functions
  - Add handlers for `devices_list`, `device_revoked`, `device_renamed` (auto-refresh list on mutation)
  - Return new state + commands from hook
- **MIRROR**: MOBILE_COMMAND, MOBILE_HANDLER
- **VALIDATE**: `cd mobile && npx tsc --noEmit`

### Task 7: Create DevicesScreen
- **ACTION**: Create `mobile/src/screens/DevicesScreen.tsx`
- **IMPLEMENT**:
  - Modal with header "Paired Devices"
  - FlatList of devices showing: name, device_id (truncated), last_seen relative time, revoked badge
  - Swipe or long-press actions: Rename (TextInput alert), Revoke (confirm alert)
  - Current device highlighted (match against own client_id)
  - Self-revocation shows warning before proceeding
- **MIRROR**: SecretsScreen pattern (list + actions), SettingsScreen modal structure
- **VALIDATE**: `cd mobile && npx tsc --noEmit`

### Task 8: Wire DevicesScreen into SettingsScreen
- **ACTION**: Add "Paired Devices" row in SettingsScreen
- **IMPLEMENT**: Add a row after existing settings sections, open DevicesScreen modal on press. Pass `devices`, `listDevices`, `revokeDevice`, `renameDevice` props.
- **MIRROR**: Existing settings section pattern
- **VALIDATE**: `cd mobile && npx tsc --noEmit`

### Task 9: Move token to SecureStore with biometric protection
- **ACTION**: Update ConnectScreen to store token in SecureStore after QR/manual pairing
- **IMPLEMENT**:
  - After successful connection, save: `SecureStore.setItemAsync('navette_token', token)`
  - On app launch, retrieve: `SecureStore.getItemAsync('navette_token')` — this is gated by the existing LockScreen biometric flow
  - Remove any AsyncStorage token storage
  - LockScreen already gates app access with biometric — token in SecureStore means it's inaccessible without biometric success
- **MIRROR**: MOBILE_SECURE_STORE, MOBILE_BIOMETRIC
- **GOTCHA**: `expo-secure-store` and `expo-local-authentication` already in package.json — no new deps needed
- **VALIDATE**: `cd mobile && npx tsc --noEmit`

---

## Testing Strategy

### Unit Tests (Rust)

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `upsert_device_creates_and_updates` | upsert same device_id twice | paired_at stable, last_seen updated | No |
| `revoke_device_blocks_lookup` | upsert then revoke | is_device_revoked returns true | No |
| `rename_device_works` | upsert then rename | list shows new name | No |
| `list_devices_returns_all` | insert 3 devices | list returns 3 with correct fields | No |
| `unknown_device_not_revoked` | check non-existent id | is_device_revoked returns false | Yes |

### Edge Cases Checklist
- [x] Unknown device_id returns not-revoked (first connection)
- [ ] Self-revocation (allowed, next reconnect fails)
- [ ] Empty device list returns empty array
- [ ] Rename non-existent device (no-op, no error)
- [ ] Revoke non-existent device (no-op, no error)
- [ ] Very long device name (accept, no validation needed — client_id is max 255 chars)

---

## Validation Commands

### Static Analysis
```bash
cargo clippy -- -D warnings
cd mobile && npx tsc --noEmit
```
EXPECT: Zero errors

### Unit Tests
```bash
cargo test
```
EXPECT: All tests pass including new device tests

### Full Build
```bash
cargo build
cd mobile && npx expo export --platform ios 2>&1 | head -5
```
EXPECT: Build succeeds

---

## Acceptance Criteria
- [ ] `devices` table created on startup
- [ ] Devices upserted on successful auth
- [ ] Revoked devices rejected before welcome
- [ ] `list_devices` / `revoke_device` / `rename_device` WS commands work
- [ ] DevicesScreen shows device list with revoke/rename actions
- [ ] Token stored in SecureStore (biometric-gated by existing LockScreen)
- [ ] All tests pass, clippy clean
- [ ] No regressions in existing 41 tests

## Completion Checklist
- [ ] Code follows discovered patterns
- [ ] Error handling uses anyhow Context
- [ ] Logging uses tracing macros
- [ ] Tests use in_memory_db helper
- [ ] No hardcoded values
- [ ] Mutex never held across .await

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Mutex held across await | Medium | Deadlock | Lock/drop pattern enforced in every handler |
| Self-revocation confusion | Low | UX | Confirm dialog before self-revoke |
| SecureStore unavailable on simulator | Low | Dev friction | PIN fallback already exists |

## Notes
- `expo-local-authentication` and `expo-secure-store` are already installed — no new mobile deps
- The existing LockScreen biometric flow gates all app access — storing the token in SecureStore means biometric is effectively required to authenticate
- Device names default to client_id; user can rename via the DevicesScreen
