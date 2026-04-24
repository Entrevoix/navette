# PR Review: #14 — fix: harden codebase from security + quality audit (Round 2)

**Reviewed**: 2026-04-23
**Author**: bearyjd
**Branch**: fix/codebase-audit-fixes → main
**Decision**: APPROVE with comments

## Summary

Second-pass review after applying fixes from round 1. Two regressions from R1 fixes have been corrected, plus 3 additional hardening improvements. All HIGH findings resolved. Remaining items are LOW/pre-existing debt.

## Findings

### CRITICAL
None

### HIGH
None (all resolved in this round)

**Resolved in this commit:**
- **H1 (db.rs)** — Migration guard `extended_code == 1` was too broad, swallowing all SQLITE_ERROR. Fixed: now checks both error code AND message contains "duplicate column".
- **H3 (hook.rs)** — `persist_and_emit` silently dropped DB insert failures via `unwrap_or(0)`. Fixed: now logs with `tracing::error`.
- **H4 (ws.rs)** — Approval policy set/delete held mutex on async thread. Fixed: wrapped in `spawn_blocking`.
- **TS-H1 (ApprovalPolicyScreen)** — `cycleAction` regression: added `deny→prompt` made `allow` unreachable. Fixed: cycle is now `prompt→allow→deny→prompt`.

### MEDIUM

- **M6 (ws.rs, pre-existing)** — `list_dir` and `read_file` canonicalize fallback bypassed path checks. Fixed: now rejects with error when canonicalize fails.
- **M-TS2 (ApprovalPolicyScreen)** — No debounce on rapid taps; multiple mutations sent before server responds. Low risk since server is authoritative. Not fixed (UX polish, not safety).
- **M-TS3 (ApprovalPolicyScreen)** — Custom tool name input has no length/format validation. Server uses parameterized queries so no injection risk. Not fixed (hardening, not safety).
- **M-TS4 (ConnectScreen)** — `JSON.parse` cast via `as` without shape validation. Pre-existing pattern. Not fixed.

### LOW

- L1: `ntfy_topic` still logged at startup (semi-secret). Pre-existing.
- L2: Triple JSON parse in `claude.rs` event processing. Pre-existing performance concern.
- L3: Policy action compared with string equality in `hook.rs` rather than enum. Pre-existing.
- L4: `SettingsScreen` destructured props line is very long. Pre-existing.

## Validation Results

| Check | Result |
|---|---|
| cargo fmt | Pass |
| cargo clippy -- -D warnings | Pass |
| cargo test (49/49) | Pass |
| npx tsc --noEmit | Pass (1 pre-existing expo-camera error in ConnectScreen, unrelated) |

## Files Reviewed

| File | Change Type |
|---|---|
| src/ws.rs | Modified |
| src/hook.rs | Modified |
| src/notify.rs | Modified |
| src/main.rs | Modified |
| src/config.rs | Modified |
| src/claude.rs | Modified |
| src/db.rs | Modified |
| mobile/App.tsx | Modified |
| mobile/src/hooks/useNavettedWS.ts | Modified |
| mobile/src/screens/ApprovalPolicyScreen.tsx | Added |
| mobile/src/screens/ConnectScreen.tsx | Modified |
| mobile/src/screens/MainScreen.tsx | Modified |
| mobile/src/screens/SettingsScreen.tsx | Modified |
| mobile/src/types/index.ts | Modified |
