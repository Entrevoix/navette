# Implementation Report: WebSocket TLS Transport

## Summary
Added TLS encryption to the navetted WebSocket server using rustls with the ring crypto provider. Auto-generates a self-signed certificate (with local IP SAN) on first config creation. Mobile connects via `wss://` when `tls` flag is set. Fully backward-compatible — no TLS config means plain `ws://`.

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Medium | Medium |
| Confidence | 8/10 | 9/10 |
| Files Changed | 7 | 7 (+ Cargo.lock auto-generated) |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | Add TLS dependencies | Done | rustls (ring feature), tokio-rustls, rustls-pemfile, rcgen |
| 2 | Add TLS config fields | Done | tls_cert_path, tls_key_path + auto-gen + tls_enabled() |
| 3 | TLS acceptor in ws.rs | Done | Generic handle_ws<S>, TlsAcceptor wrapping |
| 4 | Wire TLS into main.rs | Done | load_tls_acceptor + QR payload tls flag |
| 5 | Mobile wss:// support | Done | ServerConfig.tls, scheme selection, QR parsing |
| 6 | Tests | Done | 6 new tests across config.rs and ws.rs |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (Rust) | Pass | clippy zero warnings |
| Static Analysis (TS) | Pass | tsc clean (expo-camera error is pre-existing) |
| Unit Tests | Pass | 47 tests (6 new) |
| Build | Pass | cargo check clean |
| Integration | N/A | Requires running daemon + mobile app |

## Files Changed

| File | Action | Lines |
|---|---|---|
| `Cargo.toml` | UPDATED | +4 (rustls, tokio-rustls, rustls-pemfile, rcgen) |
| `src/config.rs` | UPDATED | +60 (TLS fields, generate_self_signed_cert, tls_enabled, 4 tests) |
| `src/ws.rs` | UPDATED | +85 (load_tls_acceptor, generic handle_ws, TLS branch in serve, 2 tests) |
| `src/main.rs` | UPDATED | +8 (load TLS acceptor, pass to serve, QR tls flag) |
| `mobile/src/types/index.ts` | UPDATED | +1 (tls field on ServerConfig) |
| `mobile/src/hooks/useNavettedWS.ts` | UPDATED | +2 (wss:// scheme selection) |
| `mobile/src/screens/ConnectScreen.tsx` | UPDATED | +6 (tls state, fillForm, handleSave, handleConnect, QR parse) |

## Deviations from Plan
- Used explicit `builder_with_provider(ring::default_provider())` instead of relying on feature flags, because aws-lc-rs is pulled transitively and conflicts with the ring feature auto-detection
- Added `generate_self_signed_cert_for_test` helper in config.rs to expose cert generation to ws.rs tests

## Issues Encountered
- rustls `CryptoProvider` auto-detection fails when both `ring` and `aws-lc-rs` features are enabled transitively. Fixed by using explicit provider in `ServerConfig::builder_with_provider()`.

## Tests Written
| Test | Coverage |
|---|---|
| `tls_disabled_when_no_paths` | Config with no TLS paths returns false |
| `tls_disabled_when_files_missing` | Config with nonexistent paths returns false |
| `tls_enabled_when_files_exist` | Config with generated cert files returns true |
| `generate_cert_creates_valid_pem_files` | Cert generation produces valid PEM content |
| `load_tls_acceptor_none_when_no_paths` | No TLS config returns None acceptor |
| `load_tls_acceptor_with_generated_cert` | Generated cert produces working TlsAcceptor |

## Next Steps
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
