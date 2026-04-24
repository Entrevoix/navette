# Plan: Codebase Audit Fixes

## Summary
Fix all findings from the comprehensive security + code quality audit: 2 CRITICAL, 14 HIGH, 16 MEDIUM, 12 LOW across the Rust backend and React Native mobile app. Organized into 3 phases by severity.

## User Story
As a navette operator, I want the daemon and mobile app to be hardened against path traversal, silent failures, injection, and concurrency bugs, so that my Claude Code approval flow is secure and reliable.

## Problem → Solution
Audit identified 44 findings across security, error handling, input validation, and async correctness → Fix all actionable items in priority order, skipping design-level changes (cert pinning, WS rate limiting) for a future sprint.

## Metadata
- **Complexity**: Large
- **Source PRD**: N/A (audit-driven)
- **PRD Phase**: N/A
- **Estimated Files**: 9

---

## UX Design

N/A — internal hardening, no user-facing UX transformation.

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/ws.rs` | 670-690 | Path traversal check to fix |
| P0 | `src/ws.rs` | 1080-1110 | Silent DB error pattern to fix |
| P0 | `src/ws.rs` | 498-503 | `spawn_blocking` pattern to mirror |
| P0 | `src/ws.rs` | 918-925 | `set_secret` error handling pattern to mirror |
| P1 | `src/hook.rs` | 95-115 | Policy check + read_to_string |
| P1 | `src/notify.rs` | 77-93 | Telegram HTML injection |
| P1 | `src/main.rs` | 138-165 | Notification dispatch with tool names |
| P1 | `mobile/src/hooks/useNavettedWS.ts` | 12, 105-107, 308-318, 696 | Mobile fixes |
| P2 | `src/config.rs` | 55-58, 171-177 | Cast validation + log cleanup |
| P2 | `src/claude.rs` | 46-47, 176-188 | Command validation + clone cleanup |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| tokio `AsyncReadExt::take` | tokio docs | `stream.take(limit)` caps bytes before `read_to_string` |
| expo-crypto | expo docs | `Crypto.randomUUID()` for CSPRNG device IDs |

---

## Patterns to Mirror

### SPAWN_BLOCKING_DB
// SOURCE: src/ws.rs:498-503
```rust
let db2 = db.clone();
let sessions_data = tokio::task::spawn_blocking(move || {
    let conn = db2.lock().unwrap();
    db::get_session_list(&conn)
})
.await
.context("spawn_blocking panicked")?
.unwrap_or_default();
```

### ERROR_HANDLING_DB_WRITE
// SOURCE: src/ws.rs:918-940 (set_secret)
```rust
let save_result = tokio::task::spawn_blocking(move || {
    let key = db::derive_secret_key(&set_token)?;
    let (encrypted, nonce) = db::encrypt_secret(&key, set_value.as_bytes())?;
    let conn = db2.lock().unwrap();
    db::set_secret(&conn, &set_name, &encrypted, &nonce, unix_ts())
})
.await
.context("spawn_blocking panicked")?;
let reply = match save_result {
    Ok(()) => serde_json::json!({ "type": "secret_set", "name": name, "ok": true }),
    Err(e) => serde_json::json!({ "type": "secret_set", "name": name, "ok": false, "error": e.to_string() }),
};
```

### READYSTATE_GUARD
// SOURCE: mobile/src/hooks/useNavettedWS.ts:122-130 (typical command)
```typescript
const killSession = useCallback((sessionId: string) => {
  if (wsRef.current?.readyState === WebSocket.OPEN) {
    wsRef.current.send(JSON.stringify({ type: 'kill_session', session_id: sessionId }));
  }
}, []);
```

### TEST_STRUCTURE
// SOURCE: src/hook.rs:258-338
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn descriptive_test_name() {
        // arrange, act, assert
    }
}
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/ws.rs` | UPDATE | Fix path traversal, silent DB errors, blocking I/O, unwrap, attach parse |
| `src/hook.rs` | UPDATE | Add read size limit, fix error swallowing in policy check |
| `src/notify.rs` | UPDATE | HTML-escape Telegram messages, fix client builder |
| `src/main.rs` | UPDATE | HTML-escape tool names in notification dispatch |
| `src/config.rs` | UPDATE | Validate port range, remove token prefix from log |
| `src/claude.rs` | UPDATE | Remove unnecessary clone |
| `src/db.rs` | UPDATE | Log migration errors instead of silencing |
| `mobile/src/hooks/useNavettedWS.ts` | UPDATE | CSPRNG device ID, readyState guards, fix connectWS deps |
| `mobile/src/screens/ConnectScreen.tsx` | UPDATE | Add try-catch around JSON.parse calls |

## NOT Building

- WS auth rate limiting (requires new dependency or custom implementation — future sprint)
- Certificate pinning in mobile app (design-level change — future sprint)
- Time-limited QR pairing tokens (protocol change — future sprint)
- Refactoring `handle_ws` into per-message-type handlers (large refactor — future sprint)
- React Context to replace prop drilling (large refactor — future sprint)
- `require_v2_auth` config flag (protocol change — future sprint)
- Hook socket authentication (protocol change — future sprint)
- Accessibility labels across all screens (separate a11y sprint)

---

## Step-by-Step Tasks

### Task 1: Fix write_file path traversal (CRITICAL)
- **ACTION**: Replace `contains("/.claude/")` string check with proper `starts_with` on PathBuf
- **IMPLEMENT**: Build `claude_dir` from `home + ".claude"`, then check `canonical.starts_with(&claude_dir)`
- **MIRROR**: The `list_dir` handler already uses `canonical.starts_with(&home)` — extend that pattern
- **IMPORTS**: None new
- **GOTCHA**: Must build `claude_dir` using `PathBuf::from(&home).join(".claude")`, not string concatenation
- **VALIDATE**: `cargo test --all && cargo clippy -- -D warnings`

```rust
// BEFORE (ws.rs:682):
} else if !canonical.to_string_lossy().contains("/.claude/") {

// AFTER:
} else if !canonical.starts_with(&std::path::PathBuf::from(&home).join(".claude")) {
```

### Task 2: Propagate DB errors on approval policy mutations (CRITICAL)
- **ACTION**: Replace `let _ =` with proper error handling on `set_approval_policy` and `delete_approval_policy`
- **IMPLEMENT**: Mirror the `set_secret` pattern — capture Result, return error response on failure
- **MIRROR**: ERROR_HANDLING_DB_WRITE pattern
- **IMPORTS**: None new
- **GOTCHA**: The `db.lock().unwrap()` is inside a sync block — keep it there, just capture the Result
- **VALIDATE**: `cargo test --all && cargo clippy -- -D warnings`

```rust
// BEFORE (ws.rs:1081-1085):
{
    let conn = db.lock().unwrap();
    let _ = db::set_approval_policy(&conn, &tool_name, &action, now);
}

// AFTER:
let result = {
    let conn = db.lock().unwrap();
    db::set_approval_policy(&conn, &tool_name, &action, now)
};
let reply = match result {
    Ok(()) => serde_json::json!({
        "type": "approval_policy_set",
        "tool_name": tool_name,
        "action": action,
    }),
    Err(e) => serde_json::json!({
        "type": "error",
        "error": format!("failed to set approval policy: {e}"),
    }),
};
```

Same pattern for `delete_approval_policy`.

### Task 3: Add size limit on hook socket read (HIGH)
- **ACTION**: Wrap the stream in `AsyncReadExt::take()` before `read_to_string`
- **IMPLEMENT**: `stream.take(65536).read_to_string(&mut buf)` — 64 KiB is more than enough for any hook request
- **MIRROR**: N/A — new pattern
- **IMPORTS**: `use tokio::io::AsyncReadExt;` (already imported)
- **GOTCHA**: `take()` consumes the reader, so need to restructure — use `(&mut stream).take(65536)`
- **VALIDATE**: `cargo test --all`

```rust
// BEFORE (hook.rs:97):
tokio::time::timeout(Duration::from_secs(5), stream.read_to_string(&mut buf))

// AFTER:
tokio::time::timeout(Duration::from_secs(5), (&mut stream).take(65536).read_to_string(&mut buf))
```

### Task 4: Fix policy check error swallowing (HIGH)
- **ACTION**: Replace `unwrap_or(None)` with explicit match that logs DB errors
- **IMPLEMENT**: Match on the Result, log errors, default to "prompt"
- **MIRROR**: LOGGING pattern from hook.rs
- **IMPORTS**: None new
- **GOTCHA**: Keep the MutexGuard dropped before any `.await` — the scoped block `{ }` must remain
- **VALIDATE**: `cargo test --all`

```rust
// BEFORE (hook.rs:105-110):
let policy_action = {
    let conn = db.lock().unwrap();
    db::get_approval_policy(&conn, &req.tool_name)
        .unwrap_or(None)
        .unwrap_or_else(|| "prompt".to_string())
};

// AFTER:
let policy_action = {
    let conn = db.lock().unwrap();
    match db::get_approval_policy(&conn, &req.tool_name) {
        Ok(Some(action)) => action,
        Ok(None) => "prompt".to_string(),
        Err(e) => {
            tracing::error!(tool = %req.tool_name, "policy lookup failed: {e:#}");
            "prompt".to_string()
        }
    }
};
```

### Task 5: HTML-escape Telegram notification values (HIGH)
- **ACTION**: Add an `html_escape` helper in `notify.rs` and apply it to all interpolated values in `send_telegram` callers
- **IMPLEMENT**: Simple replace of `&`, `<`, `>` characters. Apply in `main.rs` where tool names are interpolated.
- **MIRROR**: N/A — new utility
- **IMPORTS**: None new
- **GOTCHA**: Escape at the call site in main.rs, not inside `send_telegram` (which takes arbitrary pre-formatted text)
- **VALIDATE**: `cargo test --all`

```rust
// Add to notify.rs:
pub fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}
```

Then in main.rs, wrap tool names:
```rust
let tool = crate::notify::html_escape(v["tool_name"].as_str().unwrap_or("tool"));
```

### Task 6: Move filesystem I/O to spawn_blocking (HIGH)
- **ACTION**: Wrap `list_dir`, `read_file`, `write_file`, and `list_skills` filesystem operations in `tokio::task::spawn_blocking`
- **IMPLEMENT**: Clone necessary variables, move fs work into blocking closure, await result
- **MIRROR**: SPAWN_BLOCKING_DB pattern from `list_past_sessions`
- **IMPORTS**: None new
- **GOTCHA**: The closures need owned copies of `home`, `path`, etc. — clone before the move. The response JSON can be built inside the closure since it's `Send`.
- **VALIDATE**: `cargo test --all && cargo clippy -- -D warnings`

### Task 7: Fix attach phase JSON parse (HIGH)
- **ACTION**: Replace `unwrap_or_default()` with proper validation
- **IMPLEMENT**: Parse, check for valid structure, reject with error if malformed
- **MIRROR**: The hello phase already validates structure
- **GOTCHA**: Don't break backward compatibility — still accept valid attach messages
- **VALIDATE**: `cargo test --all`

```rust
// BEFORE (ws.rs:256):
let msg: Value = serde_json::from_str(&txt).unwrap_or_default();

// AFTER:
let msg: Value = match serde_json::from_str(&txt) {
    Ok(v) => v,
    Err(_) => {
        tracing::warn!("invalid JSON in attach message");
        serde_json::json!({})
    }
};
```

### Task 8: Replace unwrap with expect in welcome/rejected (MEDIUM)
- **ACTION**: Replace `.unwrap()` with `.expect("static JSON serialization")` in `welcome()` and `rejected()`
- **IMPLEMENT**: One-line change each
- **MIRROR**: N/A
- **IMPORTS**: None
- **GOTCHA**: None — these truly cannot fail, just adding documentation
- **VALIDATE**: `cargo clippy -- -D warnings`

### Task 9: Fix reqwest client builder (MEDIUM)
- **ACTION**: Replace `.unwrap_or_default()` with `.expect("reqwest client build")`
- **IMPLEMENT**: One-line change in notify.rs:24-25
- **MIRROR**: N/A
- **IMPORTS**: None
- **GOTCHA**: If TLS init fails at startup, better to crash loudly than silently lose timeouts
- **VALIDATE**: `cargo clippy -- -D warnings`

### Task 10: Validate config port range (MEDIUM)
- **ACTION**: Add range check before `as u16` cast
- **IMPLEMENT**: Use `u16::try_from()` with error context
- **MIRROR**: N/A
- **IMPORTS**: None
- **GOTCHA**: Also apply to `approval_ttl_secs` and `max_concurrent_sessions` casts
- **VALIDATE**: `cargo test --all`

### Task 11: Remove token prefix from log (LOW)
- **ACTION**: Remove `token_prefix = &token[..8]` from the config generation log line
- **IMPLEMENT**: Delete the field from the `tracing::info!` call at config.rs:173
- **MIRROR**: N/A
- **IMPORTS**: None
- **GOTCHA**: None
- **VALIDATE**: `cargo clippy -- -D warnings`

### Task 12: Remove unnecessary clone in claude.rs (LOW)
- **ACTION**: Remove the redundant `.clone()` on the line variable
- **IMPLEMENT**: Consume `line` directly instead of cloning when it's under MAX_PAYLOAD
- **MIRROR**: N/A
- **IMPORTS**: None
- **GOTCHA**: Verify `line` is not used after this point
- **VALIDATE**: `cargo clippy -- -D warnings`

### Task 13: Log migration errors in db.rs (MEDIUM)
- **ACTION**: Replace `let _ = conn.execute(migration, [])` with error logging
- **IMPLEMENT**: Match on the result, ignore "duplicate column" errors, log others
- **MIRROR**: N/A
- **IMPORTS**: None
- **GOTCHA**: Must handle the "duplicate column" case gracefully — that's the expected idempotent path
- **VALIDATE**: `cargo test --all`

### Task 14: Replace Math.random with CSPRNG for CLIENT_ID (HIGH)
- **ACTION**: Use `expo-crypto` for device ID generation
- **IMPLEMENT**: Import `Crypto` from `expo-crypto`, use `Crypto.randomUUID()`
- **MIRROR**: N/A — new pattern
- **IMPORTS**: `import * as Crypto from 'expo-crypto';`
- **GOTCHA**: `expo-crypto` is already in dependencies. `randomUUID()` is synchronous in expo-crypto.
- **VALIDATE**: `cd mobile && npx tsc --noEmit`

```typescript
// BEFORE:
const CLIENT_ID = `mobile-${Math.random().toString(36).slice(2, 8)}`;

// AFTER:
import * as Crypto from 'expo-crypto';
const CLIENT_ID = `mobile-${Crypto.randomUUID()}`;
```

### Task 15: Add readyState guards on policy WS commands (HIGH)
- **ACTION**: Add `readyState === WebSocket.OPEN` check to `getApprovalPolicies`, `setApprovalPolicyFn`, `deleteApprovalPolicyFn`
- **IMPLEMENT**: Match the pattern used by every other command in the file
- **MIRROR**: READYSTATE_GUARD pattern
- **IMPORTS**: None
- **GOTCHA**: None
- **VALIDATE**: `cd mobile && npx tsc --noEmit`

### Task 16: Fix connectWS stale closure (MEDIUM)
- **ACTION**: Replace `sessions.length` dependency with a ref
- **IMPLEMENT**: Add `sessionsLengthRef` that tracks `sessions.length`, use it inside the closure
- **MIRROR**: Other refs in the file (e.g., `sessionRunningRef`)
- **IMPORTS**: None
- **GOTCHA**: Must update the ref in a useEffect that depends on `sessions.length`
- **VALIDATE**: `cd mobile && npx tsc --noEmit`

### Task 17: Add try-catch around JSON.parse in ConnectScreen (MEDIUM)
- **ACTION**: Wrap all three `JSON.parse` calls in try-catch with graceful fallback
- **IMPLEMENT**: On parse failure, log error and use empty array / null
- **MIRROR**: N/A
- **IMPORTS**: None
- **GOTCHA**: The QR code parse at line 169 is already inside a try-catch block (lines 165-184) — verify and ensure it's adequate
- **VALIDATE**: `cd mobile && npx tsc --noEmit`

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `write_file_rejects_path_outside_claude_dir` | path=`~/.claude/../.ssh/key` | `ok: false, error: "writes restricted"` | Yes |
| `write_file_allows_path_inside_claude_dir` | path=`~/.claude/settings.json` | `ok: true` | No |
| `set_approval_policy_returns_error_on_db_failure` | corrupt DB | error response | Yes |
| `html_escape_handles_angle_brackets` | `<script>` | `&lt;script&gt;` | No |
| `html_escape_handles_ampersand` | `A&B` | `A&amp;B` | No |
| `hook_request_size_limited` | 128KB payload | timeout/error | Yes |

### Edge Cases Checklist
- [x] Path traversal via `..` in write_file
- [x] Path with `.claude` as substring in non-target directory
- [x] DB write failure on policy set
- [x] Oversized hook request
- [x] HTML in tool names
- [x] Port number out of u16 range
- [x] Malformed JSON in attach message
- [x] WS send when connection is CONNECTING (not OPEN)

---

## Validation Commands

### Static Analysis
```bash
cargo fmt --check
cargo clippy -- -D warnings
cd mobile && npx tsc --noEmit
```
EXPECT: Zero errors

### Unit Tests
```bash
cargo test --all
cd mobile && npx jest --forceExit
```
EXPECT: All tests pass, including new tests

### Full Build
```bash
cargo build --release
```
EXPECT: Zero errors

---

## Acceptance Criteria
- [ ] All 17 tasks completed
- [ ] All validation commands pass
- [ ] New tests written for path traversal fix and HTML escaping
- [ ] No type errors (Rust + TypeScript)
- [ ] No clippy warnings
- [ ] Zero CRITICAL or HIGH findings remaining

## Completion Checklist
- [ ] Path traversal fixed with `starts_with` on PathBuf
- [ ] All DB write errors propagated to client
- [ ] Hook socket reads capped at 64 KiB
- [ ] Policy check logs DB errors
- [ ] Telegram notifications HTML-escaped
- [ ] All filesystem I/O in spawn_blocking
- [ ] Attach phase validates JSON
- [ ] welcome/rejected use expect not unwrap
- [ ] reqwest client builder fails loudly
- [ ] Config port validated before cast
- [ ] Token prefix removed from log
- [ ] Unnecessary clone removed
- [ ] Migration errors logged
- [ ] CLIENT_ID uses CSPRNG
- [ ] Policy WS commands have readyState guard
- [ ] connectWS closure fixed
- [ ] ConnectScreen JSON.parse wrapped in try-catch

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| spawn_blocking refactor breaks WS message ordering | Low | Medium | Keep response assembly outside the blocking closure |
| expo-crypto randomUUID not available on older Expo SDK | Low | Low | Already on Expo 52 which supports it |
| Migration error logging produces noise on existing DBs | Medium | Low | Only log non-duplicate-column errors |

## Notes
- Design-level items (cert pinning, rate limiting, v2-only auth, handle_ws refactor, React Context) are explicitly deferred to a future sprint
- The 21 `db.lock().unwrap()` calls should eventually be hardened against mutex poisoning, but that's a cross-cutting change better done as a separate task
- The `command` field in claude.rs is documented as an intentional trust boundary (authenticated clients are trusted) — not fixing in this pass
