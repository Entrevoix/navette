# Review Log

## Plan 5: navette-ux-fixes

**Branch**: `feat/navette-ux-fixes`
**Date**: 2026-04-24
**Status**: PENDING PR

### Scope

19 of 24 tasks were already implemented. Remaining gap: `webhook_url` config field existed but was never wired into the notification handler. Implemented webhook POST on `session_ended` events.

### Devil's Advocate Review (5 rounds)

| Topic | Rounds | Action Items |
|---|---|---|
| Correctness | 1 | 0 |
| Error handling | 1 | 1 |
| Security | 1 | 0 |
| Maintainability | 1 | 0 |
| Testing gaps | 1 | 1 |
| **Total** | **5** | **2** |

### Action Items (2) — All Fixed

1. **LOW** — `publish_webhook` used identical log message for HTTP status errors and connection errors. Changed HTTP status branch to `"webhook POST returned error status: {e}"` (Error handling)
2. **LOW** — No tests for `publish_webhook` early-return paths. Added 2 async smoke tests: `publish_webhook_skips_when_url_is_none`, `publish_webhook_skips_when_url_is_empty` (Testing gaps)

### Deferred (not fixed)

- No retry/backoff on webhook failures — same fire-and-forget pattern as ntfy and Telegram; cross-cutting concern for a future PR (LOW)
- Webhook only fires on `session_ended`, not approval events — intentional per plan scope (LOW)

### Validation

- cargo build: PASS
- cargo test: 65/65 PASS (2 new webhook tests)
- cargo clippy: PASS (zero warnings)

---

## Plan 4: android-aab-release-build

**Branch**: `feat/android-aab-release-build`
**Date**: 2026-04-23
**Status**: PENDING PR

### Devil's Advocate Review (4 rounds, consensus reached)

| Topic | Rounds | Action Items |
|---|---|---|
| Correctness | 2 | 2 |
| Error handling | 1 | 1 |
| Performance | 0 | 0 |
| Security | 0 | 0 |
| Maintainability | 0 | 0 |
| Testing gaps | 1 | 1 |
| **Total** | **4** | **4** |

### Action Items (4) — All Fixed

1. **HIGH** — `configureReleaseBuildType` regex `/buildTypes\s*\{[^}]*release\s*\{([^}]*)}/s` fails when debug block precedes release block because `[^}]*` stops at debug's closing brace. Replaced regex with `findBlock()` using brace-matching (Correctness)
2. **LOW** — `findMatchingBrace` call site used fragile offset `signingIdx + 'signingConfigs '.length`. Changed to `buildGradle.indexOf('{', signingIdx)` (Correctness)
3. **MEDIUM** — `configureReleaseBuildType` silently returned unchanged on match failure. Added `console.warn` with descriptive message (Error handling)
4. **MEDIUM** — No unit tests for string-manipulation functions. Added 18 tests in `plugins/__tests__/withReleaseSigning.test.js` (Testing gaps)

### Deferred (not fixed)

- `findMatchingBrace` doesn't handle braces inside comments/strings — accepted risk since Expo-generated signingConfigs blocks don't contain comments (LOW)
- Whitespace inconsistency at injection point — cosmetic only, Groovy is whitespace-insensitive (LOW)

### Validation

- tsc --noEmit: PASS
- jest: 120/120 PASS (18 new plugin tests)
- Plugin tests verify: brace matching, block finding, signing injection, idempotency, debug-before-release scenario, end-to-end pipeline

---

## Plan 3: expo-54-rn-upgrade

**Branch**: `feat/expo-54-rn-upgrade`
**Date**: 2026-04-23
**Status**: PENDING PR

### Devil's Advocate Review (5 rounds, early consensus at 4)

| Topic | Rounds | Action Items |
|---|---|---|
| Correctness | 2 | 1 |
| Error handling | 0 | 0 |
| Performance | 0 | 0 |
| Security | 0 | 0 |
| Maintainability | 1 | 0 |
| Testing gaps | 1 | 1 |
| **Total** | **4** | **2** |

### Action Items (2) — All Fixed

1. Pin `react-test-renderer` with `~19.1.0` tilde range instead of exact `19.1.0` (Correctness)
2. Remove dead `mockGetPermissionsAsync` setup in permission-denied test (Testing gaps)

### Key Decisions

- Jest 30.x→29.x downgrade: jest-expo 54 bundles `@jest/*@^29.2.1` internally, incompatible with Jest 30
- `react-native-worklets` added: new peer dep of reanimated v4.x
- `expo-speech-recognition` stays at `^3.1.2`: third-party package, not Expo SDK versioned
- Android 16 permission workaround removed: fixed in RN 0.81.5+

### Validation

- tsc --noEmit: PASS
- jest: 102/102 PASS
- npm install: PASS (--legacy-peer-deps)

---

## Plan 2: websocket-tls

**Status**: ALREADY IMPLEMENTED (no PR needed)
**Date**: 2026-04-23

All 6 tasks verified present in codebase:
- Task 1: TLS deps in Cargo.toml (tokio-rustls, rustls-pemfile, rcgen)
- Task 2: Config fields + tls_enabled() + generate_self_signed_cert() in config.rs
- Task 3: load_tls_acceptor() + generic stream in ws.rs
- Task 4: TLS acceptor wired in main.rs, QR payload includes tls flag
- Task 5: Mobile wss:// in useNavettedWS.ts:488, tls field in ServerConfig
- Task 6: Tests: tls_disabled_when_no_paths, tls_disabled_when_files_missing, tls_enabled_when_files_exist, generate_cert_creates_valid_pem_files

---

## Plan 1: auth-pairing-phase4

**Branch**: `feat/auth-pairing-phase4`
**PR**: #19
**Date**: 2026-04-23
**Status**: MERGED

### Devil's Advocate Review (5 rounds)

| Topic | Rounds | Action Items |
|---|---|---|
| Correctness | 2 | 2 |
| Error handling | 1 | 1 |
| Performance | 0 | 0 |
| Security | 0 | 0 |
| Maintainability | 0 | 0 |
| Testing gaps | 1 | 0 |
| **Total** | **4** | **3** |

### Action Items (3) — All Fixed

1. Fix `needsStrip` to use `!!configs[i].token` instead of `!== ''` (Correctness)
2. Add `else` branch in `handleSave` to delete token from SecureStore when empty (Correctness)
3. Add `__DEV__` warning in catch block for config load failures (Error handling)

### Deferred

- Tailscale API key still in plain AsyncStorage (LOW, out of scope)
- No unit tests for SecureStore migration logic (extracting testable module is scope creep)

### Validation

- cargo build: PASS
- cargo test: 63/63 PASS
- tsc --noEmit: PASS
- jest: 102/102 PASS
