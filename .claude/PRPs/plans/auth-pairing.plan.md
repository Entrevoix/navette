# Auth Pairing Plan

## Summary
Secure the navetted WebSocket connection with QR-based pairing and challenge-response authentication. Phase 1 (vault key decoupling) is complete. This plan covers Phases 2–3.

## Phase 2: QR Pairing (in-progress)

> Plan: `.claude/PRPs/plans/qr-pairing.plan.md`

### Goal
Let users pair their mobile device by scanning a QR code displayed in the terminal, instead of manually copying connection details.

### Tasks

1. **Add `qrcode` dependency** — `qrcode = "0.14"` for terminal QR rendering
2. **Add `--pair` CLI flag** to navetted that:
   - Loads config (to get token + port)
   - Detects the machine's local IP(s)
   - Builds a pairing payload: `{"host":"<ip>","port":<port>,"token":"<token>"}`
   - Base64-encodes the payload
   - Renders a QR code to the terminal containing `navette://<base64>`
   - Exits (does not start the daemon)
3. **Add `pair` WS command** — authenticated clients can request the pairing payload (for re-sharing)

### Validation
- `navetted --pair` prints a scannable QR to terminal
- `cargo test` passes
- `cargo clippy -- -D warnings` clean

## Phase 3: Challenge-Response Auth (in-progress)

### Goal
Replace plaintext token transmission with HMAC-SHA256 challenge-response. The token never crosses the wire.

### Tasks

1. **New auth protocol in `ws.rs`**:
   - Client sends `{"type":"hello","version":2,"client_id":"..."}`  (no token)
   - Server responds `{"type":"challenge","nonce":"<32-byte-hex>"}`
   - Client responds `{"type":"challenge_response","hmac":"<hex>"}`
     where hmac = HMAC-SHA256(key=token, message=nonce)
   - Server verifies HMAC in constant time
2. **Backward compatibility**: If `hello` contains a `token` field (version 1 / legacy), accept it with the existing constant-time compare
3. **Tests**: challenge-response success, wrong HMAC rejection, legacy hello still works

### Validation
- All existing tests pass (backward compat)
- New challenge-response tests pass
- `cargo clippy -- -D warnings` clean

## Phase 4: Device Management + Biometric Token Protection

### Goal
Track paired devices with revocation support. Store the auth token in biometric-protected secure storage on mobile.

### Plan
See `.claude/PRPs/plans/device-management-biometric.plan.md` for the full implementation plan (9 tasks, 6 files).

### Summary
1. **`devices` table** in SQLite with device_id, name, paired_at, last_seen, revoked
2. **Device CRUD** — upsert, list, revoke, rename functions in `db.rs`
3. **Revocation enforcement** in WS auth phase — reject revoked devices before welcome
4. **3 new WS commands** — `list_devices`, `revoke_device`, `rename_device`
5. **Mobile DevicesScreen** — list paired devices with rename/revoke actions
6. **Biometric token storage** — move auth token from AsyncStorage to `expo-secure-store`, gated by existing LockScreen biometric flow

### Validation
- `cargo test` passes (including new device tests)
- `cargo clippy -- -D warnings` clean
- `cd mobile && npx tsc --noEmit` clean

---


## Acceptance Criteria
- [ ] `navetted --pair` shows QR with connection info
- [ ] Challenge-response auth works for new clients
- [ ] Legacy token auth still works (backward compat)
- [ ] Devices tracked on auth, revocation enforced
- [ ] DevicesScreen accessible from Settings
- [ ] Token stored in biometric-gated SecureStore
- [ ] All tests pass, clippy clean
