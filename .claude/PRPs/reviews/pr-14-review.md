# PR Review: #14 — fix: harden codebase from security + quality audit

**Reviewed**: 2026-04-23
**Author**: bearyjd
**Branch**: fix/codebase-audit-fixes → main
**Decision**: REQUEST CHANGES

## Summary

Comprehensive security hardening addressing 17 audit findings across the Rust daemon and React Native mobile app. The core fixes (path traversal, DB error propagation, HTML escaping, CSPRNG device IDs) are well-implemented. Two HIGH issues in the Rust backend and one HIGH pattern inconsistency in the mobile app should be resolved before merge.

## Findings

### CRITICAL

None.

### HIGH

**H1. `src/ws.rs:686-691` — `write_file` containment bypass when parent directory doesn't exist**

The path traversal fix uses `fs::canonicalize(&parent)` with a fallback to the unresolved path when canonicalization fails (parent doesn't exist). An attacker could supply a path with symlinks in a non-existent parent, bypassing the `.claude/` containment check. The `read_file` and `list_dir` handlers don't have this issue because they operate on existing paths.

**Fix:** Reject `write_file` when `fs::canonicalize(&parent)` fails instead of falling back:
```rust
let canonical_parent = match std::fs::canonicalize(&parent) {
    Ok(p) => p,
    Err(_) => return serde_json::json!({
        "type": "file_written", "path": expanded, "ok": false,
        "error": "parent directory does not exist or is not accessible"
    }),
};
```

**H2. `src/ws.rs:266` — Silent replay-from-zero on malformed attach `since` message**

The secondary JSON parse in the attach protocol still uses `unwrap_or_default()`, silently defaulting to seq 0 on parse failure. This causes a full event replay with no warning log — inconsistent with the explicit match+warn pattern applied at line 255.

**Fix:** Apply the same match+warn pattern:
```rust
let since_msg: Value = match serde_json::from_str(&since_txt) {
    Ok(v) => v,
    Err(_) => {
        tracing::warn!("invalid JSON in since message");
        serde_json::json!({})
    }
};
```

**H3. `mobile/src/hooks/useNavettedWS.ts:628` — `getApprovalPolicies` stale closure risk**

`connectWS` captures `getApprovalPolicies` via closure but doesn't list it in its `useCallback` dependency array. Currently safe because `getApprovalPolicies` is a stable `useCallback([], [])`, but breaks the pattern used by all analogous handlers (`prompt_saved`, `secret_saved`, `device_revoked`) which inline `wsRef.current.send()` directly.

**Fix:** Replace with the inline pattern used elsewhere:
```ts
if (wsRef.current?.readyState === WebSocket.OPEN) {
  wsRef.current.send(JSON.stringify({ type: 'get_approval_policies' }));
}
```

### MEDIUM

**M1. `src/notify.rs:96-100` — Incomplete HTML escaping for Telegram parse mode**

`html_escape` only handles `&`, `<`, `>` but Telegram HTML mode also interprets `"` and `'` in attribute contexts. Add `"` → `&quot;` and `'` → `&#x27;`.

**M2. `src/config.rs:59` — Port range allows port 0**

`(0..=65535).contains(&port_i64)` permits port 0 which means "OS assigns ephemeral port" — not useful for a server config. Should be `(1..=65535)`.

**M3. `src/db.rs:84-86` — Migration error detection via fragile string matching**

`msg.contains("duplicate column")` depends on SQLite's unstable error text. Prefer matching on `rusqlite::Error::SqliteFailure` error codes.

**M4. `src/ws.rs` (multiple) — `lock().unwrap()` without poison handling in `spawn_blocking`**

A panic in any `spawn_blocking` closure that holds the DB lock will poison it, cascading panics across the process. Pre-existing debt but expanded by this PR.

**M5. `mobile/src/hooks/useNavettedWS.ts:155-165` — Incomplete readyState guards**

`listDir`, `readFile`, and `writeFile` still use unguarded `?.send()` — the PR adds guards only on the new approval policy commands. Inconsistent with the stated goal.

**M6. `mobile/src/screens/ApprovalPolicyScreen.tsx:20-24` — `cycleAction` skip of deny→prompt**

Tapping deny cycles directly to allow (the most dangerous state) with no intermediate step. Consider deny→prompt→allow or a confirmation dialog before applying allow.

**M7. `mobile/src/screens/ApprovalPolicyScreen.tsx:81` — Missing `onRequestClose` (Android back button)**

All other modals in the codebase supply `onRequestClose`. Add `onRequestClose={onClose}`.

**M8. `mobile/src/screens/ApprovalPolicyScreen.tsx:99` — Missing accessibility labels**

Policy row `Pressable` elements lack `accessibilityLabel` and `accessibilityRole="button"`.

### LOW

**L1. `src/claude.rs:215` — `enriched.clone()` for broadcast contradicts the "remove clones" goal.** Structurally required but could use `Arc<str>` in the broadcast channel long-term.

**L2. `mobile/src/hooks/useNavettedWS.ts:14` — `CLIENT_ID` regenerates on Metro hot-reload.** Fine in production but consider persisting in AsyncStorage if stable device identity across restarts matters.

**L3. `mobile/src/screens/ConnectScreen.tsx:67-90` — `JSON.parse` catch silently swallows errors.** No user feedback when stored config is corrupt.

## Validation Results

| Check | Result |
|---|---|
| cargo clippy -- -D warnings | Pass |
| cargo test | Pass (49/49) |
| cargo fmt --check | Pass |
| npx tsc --noEmit | Pass (pre-existing expo-camera type issue on main) |
| cargo build | Pass |

## Files Reviewed

| File | Type | Change |
|---|---|---|
| `src/ws.rs` | Source | Modified |
| `src/hook.rs` | Source | Modified |
| `src/notify.rs` | Source | Modified |
| `src/main.rs` | Source | Modified |
| `src/config.rs` | Source | Modified |
| `src/claude.rs` | Source | Modified |
| `src/db.rs` | Source | Modified |
| `mobile/App.tsx` | Source | Modified |
| `mobile/src/hooks/useNavettedWS.ts` | Source | Modified |
| `mobile/src/screens/ApprovalPolicyScreen.tsx` | Source | Added |
| `mobile/src/screens/ConnectScreen.tsx` | Source | Modified |
| `mobile/src/screens/MainScreen.tsx` | Source | Modified |
| `mobile/src/screens/SettingsScreen.tsx` | Source | Modified |
| `mobile/src/types/index.ts` | Source | Modified |

## Artifacts Referenced

- Plan: `.claude/PRPs/plans/completed/codebase-audit-fixes.plan.md`
- Report: `.claude/PRPs/reports/codebase-audit-fixes-report.md`
