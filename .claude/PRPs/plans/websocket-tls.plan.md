# Plan: WebSocket TLS Transport

## Summary
Add TLS encryption to the navetted WebSocket server so all traffic (including HMAC auth, session data, approval payloads) is encrypted on the wire. Auto-generates a self-signed certificate on first run; supports user-provided certs. Mobile connects via `wss://` when TLS is enabled.

## User Story
As a developer running navetted on a shared network,
I want the WebSocket connection encrypted with TLS,
So that session data and auth tokens can't be sniffed by other devices on the LAN.

## Problem → Solution
WS traffic is plaintext on the LAN (even with HMAC auth, the session content is visible) → Wrap the TCP listener in a TLS acceptor using rustls.

## Metadata
- **Complexity**: Medium
- **Source PRD**: ROADMAP.md "Unplanned Primitives" — P0
- **PRD Phase**: N/A (standalone)
- **Estimated Files**: 5

---

## UX Design

N/A — internal transport change. The only visible UX change is:
- `navetted` logs `wss://` instead of `ws://`
- `navetted --pair` QR payload includes `"tls": true`
- Mobile ConnectScreen shows lock icon when TLS is active

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/ws.rs` | 28-60 | Current `serve()` — TcpListener + accept_async |
| P0 | `src/ws.rs` | 83-94 | `handle_ws` takes TcpStream, upgrades to WS |
| P0 | `src/config.rs` | 19-27 | Config struct — add TLS fields |
| P0 | `src/config.rs` | 29-157 | Config loading/generation — add TLS config |
| P0 | `src/main.rs` | 64-78 | QR pairing payload — add tls flag |
| P1 | `mobile/src/hooks/useNavettedWS.ts` | 435 | `ws://` URL construction |
| P1 | `mobile/src/screens/ConnectScreen.tsx` | 166-167 | QR payload parsing |
| P2 | `Cargo.toml` | all | Dependencies |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| tokio-rustls | crates.io/tokio-rustls | Wraps TcpStream in TlsStream; use TlsAcceptor |
| rustls-pemfile | crates.io/rustls-pemfile | Parse PEM cert/key files |
| rcgen | crates.io/rcgen | Generate self-signed X.509 certs at runtime |
| tokio-tungstenite + TLS | tokio-tungstenite docs | `accept_async` works with any `AsyncRead + AsyncWrite`, including `TlsStream<TcpStream>` |

---

## Patterns to Mirror

### CONFIG_LOADING
// SOURCE: src/config.rs:37-57
Optional fields with defaults — `tls_cert_path` and `tls_key_path` default to auto-generated paths.

### WS_SERVE
// SOURCE: src/ws.rs:28-60
`serve()` binds TcpListener, accepts in a loop, spawns per-connection tasks. TLS wraps the stream before passing to `handle_ws`.

### QR_PAIRING
// SOURCE: src/main.rs:64-78
`handle_pair()` builds JSON payload with host/port/token, base64-encodes, renders QR. Add `tls` boolean.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `Cargo.toml` | UPDATE | Add tokio-rustls, rustls-pemfile, rcgen |
| `src/config.rs` | UPDATE | Add tls_cert_path, tls_key_path fields; auto-gen cert logic |
| `src/ws.rs` | UPDATE | TLS acceptor wrapping TcpStream before WS upgrade |
| `src/main.rs` | UPDATE | Add tls flag to QR pairing payload |
| `mobile/src/hooks/useNavettedWS.ts` | UPDATE | Use wss:// when tls flag set |
| `mobile/src/screens/ConnectScreen.tsx` | UPDATE | Parse tls from QR; store in ServerConfig |
| `mobile/src/types/index.ts` | UPDATE | Add tls field to ServerConfig type |

## NOT Building

- Let's Encrypt / ACME auto-renewal (user can configure externally)
- Certificate pinning on mobile (trust-on-first-use is sufficient for LAN)
- Client certificate authentication (server cert only)
- Mutual TLS

---

## Step-by-Step Tasks

### Task 1: Add TLS dependencies to Cargo.toml
- **ACTION**: Add tokio-rustls, rustls-pemfile, rcgen to [dependencies]
- **IMPLEMENT**: `tokio-rustls = "0.26"`, `rustls-pemfile = "2"`, `rcgen = "0.13"`
- **MIRROR**: Existing dependency style in Cargo.toml
- **IMPORTS**: N/A
- **GOTCHA**: tokio-rustls 0.26 requires rustls 0.23 — ensure compatible versions. rcgen is only needed for auto-gen; could be a build-time dep but simpler as runtime.
- **VALIDATE**: `cargo check` compiles

### Task 2: Add TLS config fields
- **ACTION**: Add `tls_cert_path` and `tls_key_path` optional fields to Config
- **IMPLEMENT**:
  - Add `pub tls_cert_path: Option<String>` and `pub tls_key_path: Option<String>` to Config struct
  - Parse from TOML (default None)
  - When both are None on first run, auto-generate self-signed cert+key to `~/.config/navetted/cert.pem` and `~/.config/navetted/key.pem` using rcgen
  - Set the generated paths in config and persist to TOML
  - Add `tls_enabled()` helper that returns true when both paths are Some and files exist
- **MIRROR**: CONFIG_LOADING pattern — optional with defaults
- **IMPORTS**: `rcgen`, `std::fs`
- **GOTCHA**: Generated cert should use the machine's local IP as SAN (Subject Alternative Name) so TLS hostname verification works. Also add localhost and 127.0.0.1 as SANs.
- **VALIDATE**: `cargo test` — add test for tls_enabled logic

### Task 3: Implement TLS acceptor in ws.rs
- **ACTION**: Wrap TcpStream in TlsStream before WS upgrade
- **IMPLEMENT**:
  - Add `load_tls_config()` function that reads cert+key PEM files, builds `rustls::ServerConfig`, returns `TlsAcceptor`
  - In `serve()`, accept new parameter `tls_acceptor: Option<TlsAcceptor>`
  - If TLS enabled: `let tls_stream = acceptor.accept(stream).await?; accept_async(tls_stream)`
  - If TLS disabled: `accept_async(stream)` (existing behavior)
  - `handle_ws` must accept a generic stream — use `tokio_tungstenite::WebSocketStream<S>` where `S: AsyncRead + AsyncWrite + Unpin`
- **MIRROR**: WS_SERVE pattern
- **IMPORTS**: `tokio_rustls::TlsAcceptor`, `rustls`, `rustls_pemfile`
- **GOTCHA**: `handle_ws` currently takes `TcpStream` directly. Must be made generic over the stream type. Use `impl AsyncRead + AsyncWrite + Unpin + Send` or a concrete enum.
- **VALIDATE**: `cargo check` compiles; `cargo test` passes

### Task 4: Wire TLS into main.rs
- **ACTION**: Load TLS config at startup, pass acceptor to ws::serve
- **IMPLEMENT**:
  - After `load_or_create()`, call `ws::load_tls_config(&cfg)` if TLS paths configured
  - Pass `Option<TlsAcceptor>` to `ws::serve()`
  - Log `wss://` or `ws://` depending on TLS state
  - In `handle_pair()`, add `"tls": true/false` to QR payload
- **MIRROR**: QR_PAIRING pattern
- **IMPORTS**: N/A (ws module handles it)
- **GOTCHA**: TLS config loading should fail loudly if cert/key files are configured but missing/invalid
- **VALIDATE**: `cargo build` succeeds

### Task 5: Update mobile to support wss://
- **ACTION**: Use `wss://` when TLS flag is set in server config
- **IMPLEMENT**:
  - Add `tls?: boolean` to ServerConfig type in `types/index.ts`
  - In `useNavettedWS.ts`, build URL as `wss://` when `config.tls` is truthy
  - In `ConnectScreen.tsx`, parse `tls` from QR payload, store in saved config
  - Default `tls` to `false` for backward compat with existing saved configs
- **MIRROR**: Existing config field patterns in ConnectScreen
- **IMPORTS**: N/A
- **GOTCHA**: React Native's WebSocket on Android rejects self-signed certs by default. For LAN use, users must install the CA cert on their device. Document this in --pair output.
- **VALIDATE**: `cd mobile && npx tsc --noEmit` clean

### Task 6: Add tests
- **ACTION**: Test TLS config loading, cert generation, and connection
- **IMPLEMENT**:
  - Test: auto-generated cert files exist after config creation
  - Test: `tls_enabled()` returns false when no paths configured
  - Test: `tls_enabled()` returns true when paths configured and files exist
  - Test: `load_tls_config()` succeeds with valid PEM files
  - Test: `load_tls_config()` fails with missing files
- **MIRROR**: Existing test patterns in config.rs and ws.rs
- **IMPORTS**: `tempfile` (if not already available, use std::env::temp_dir)
- **GOTCHA**: Tests must not depend on real config files — use temp dirs
- **VALIDATE**: `cargo test` all pass

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| tls_disabled_by_default | No tls fields in TOML | tls_enabled() = false | No |
| tls_enabled_with_paths | Both paths set, files exist | tls_enabled() = true | No |
| tls_disabled_missing_files | Paths set but files don't exist | tls_enabled() = false | Yes |
| load_tls_config_valid | Valid cert+key PEM | Ok(TlsAcceptor) | No |
| load_tls_config_invalid | Garbage file | Err | Yes |
| auto_gen_cert_creates_files | Empty config dir | cert.pem + key.pem created | No |
| qr_payload_includes_tls | TLS enabled | payload has "tls": true | No |

### Edge Cases Checklist
- [ ] No TLS config → plain ws:// (backward compat)
- [ ] TLS config with missing cert file → error at startup
- [ ] Self-signed cert with wrong SAN → TLS handshake fails (expected)
- [ ] Mobile app with old config (no tls field) → defaults to ws://
- [ ] Concurrent TLS connections → TlsAcceptor is Clone + Send

---

## Validation Commands

### Static Analysis
```bash
cargo clippy -- -D warnings
```
EXPECT: Zero warnings

### Unit Tests
```bash
cargo test
```
EXPECT: All tests pass including new TLS tests

### TypeScript Check
```bash
cd mobile && npx tsc --noEmit
```
EXPECT: Zero type errors

### Manual Validation
- [ ] `navetted` starts with auto-generated cert, logs `wss://0.0.0.0:7878`
- [ ] `navetted --pair` QR includes `"tls": true`
- [ ] Mobile connects via wss:// after scanning QR
- [ ] Plain ws:// still works when TLS config removed

---

## Acceptance Criteria
- [ ] TLS wraps WebSocket when cert+key configured
- [ ] Self-signed cert auto-generated on first run
- [ ] QR pairing payload includes tls flag
- [ ] Mobile uses wss:// when tls=true
- [ ] Backward compatible — no TLS config = plain ws://
- [ ] All tests pass, clippy clean, tsc clean

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| React Native rejects self-signed cert on Android | High | High | Document: user must install CA cert on device, or use mkcert |
| tokio-rustls version conflict with existing deps | Low | Medium | Pin compatible versions |
| rcgen adds significant compile time | Low | Low | Acceptable for auto-gen convenience |

## Notes
- Self-signed certs on LAN are the expected deployment mode. For public-facing servers, users should provide their own certs (e.g., from Let's Encrypt).
- The `--pair` output should print instructions for installing the self-signed CA cert on mobile devices.
- Future: could add `--regen-cert` flag to regenerate the self-signed cert.
