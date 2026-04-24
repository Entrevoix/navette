# PR Review: #6 — feat: auth pairing — vault key, QR onboarding, challenge-response

**Reviewed**: 2026-04-23
**Author**: bearyjd
**Branch**: feat/vault-key-decoupling → main
**Decision**: APPROVE with comments

## Summary

Well-structured 3-phase PR that decouples the secrets vault from the auth token, adds QR-based mobile pairing, and hardens WebSocket auth with HMAC-SHA256 challenge-response. Crypto usage is correct (ring for HMAC, AES-256-GCM for vault, constant-time comparison). 10 new tests cover all critical paths. No blocking issues.

## Findings

### CRITICAL
None

### HIGH
None

### MEDIUM

1. **`src/db.rs:425-448` — Migration uses manual BEGIN/COMMIT instead of rusqlite Transaction API**
   If `decrypt_secret` or `encrypt_secret` fails mid-loop, `?` propagates the error and the function returns without issuing `ROLLBACK`. The `BEGIN IMMEDIATE` transaction stays open on the borrowed `Connection`. In practice the process exits on migration failure (called from `main()`), so this doesn't cause runtime issues. But the pattern is fragile — if migration is ever called from a non-fatal context, the dangling transaction would corrupt subsequent queries on the same connection.
   **Fix**: Use `conn.transaction()` or add a ROLLBACK in the error path.

2. **`src/db.rs:824-892` — `std::env::set_var("HOME", ...)` in tests is unsound in multi-threaded contexts**
   The `HOME_LOCK` mutex serializes the vault tests against each other, but `cargo test` runs all tests in a single process by default. Other tests (or library code) reading `HOME` concurrently won't hold this lock. `std::env::set_var` is marked unsafe starting in Rust 2024 edition for this reason.
   **Fix**: Accept a `data_dir` path parameter in `load_or_create_vault_key` to make it testable without mutating the environment. Or use `cargo test -- --test-threads=1` for vault tests.

### LOW

1. **`src/db.rs:454-456` — `derive_secret_key` lacks `#[deprecated]` attribute**
   Doc comment says "Deprecated" but the compiler won't warn on usage. Adding `#[deprecated(note = "use load_or_create_vault_key")]` would catch accidental new callers.

2. **`src/main.rs` — Auth token embedded in QR pairing URI**
   By design for one-time pairing, but worth noting: the token is printed to the terminal in plaintext as part of the `navette://` URI. Anyone with screen access or terminal history can extract it. Consider clearing the terminal output or noting the security implication in user-facing output.

## Validation Results

| Check | Result |
|---|---|
| Type check | Pass (cargo clippy clean) |
| Lint | Pass (cargo clippy -- -D warnings) |
| Tests | Pass (41 passed, 0 failed) |
| Build | Pass |
| CI | Pass (rust + mobile + gate) |

## Files Reviewed

| File | Change Type | Lines |
|---|---|---|
| `.claude/PRPs/plans/auth-pairing.plan.md` | Added | +53 |
| `Cargo.lock` | Modified | +130 |
| `Cargo.toml` | Modified | +6 |
| `src/db.rs` | Modified | +154 |
| `src/main.rs` | Modified | +46 / -5 |
| `src/ws.rs` | Modified | +87 / -11 |
