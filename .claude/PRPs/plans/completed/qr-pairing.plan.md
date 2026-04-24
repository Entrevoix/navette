# Plan: QR Pairing

## Summary
Add a `--pair` CLI flag to `navetted` that renders a scannable QR code in the terminal containing the connection payload (host, port, token). On the mobile side, add a "Scan QR" button to the ConnectScreen that uses the device camera to scan the QR, decode the payload, and auto-fill the connection form.

## User Story
As a navette user, I want to pair my phone by scanning a QR code shown in my terminal, so that I don't have to manually copy a host, port, and token across devices.

## Problem → Solution
Manual entry of host/port/token is error-prone and tedious → One-step QR scan pairing.

## Metadata
- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/plans/auth-pairing.plan.md`
- **PRD Phase**: Phase 2 — QR Pairing
- **Estimated Files**: 5

---

## UX Design

### Before
```
Terminal:  navetted (starts daemon, no pairing output)
Phone:    Manually type host, port, token into ConnectScreen
```

### After
```
Terminal:  navetted --pair
          ┌──────────────────────────┐
          │  ██ ▄▄▄▄▄ █ ▄▄██ ▄▄▄▄▄ │
          │  ██ █   █ █▄ ▀██ █   █  │
          │  ██ ▄▄▄▄▄ █ ▄▀██ ▄▄▄▄▄ │
          │  ... (QR code) ...       │
          └──────────────────────────┘
          Scan this QR code with navette app.
          (exits immediately, daemon not started)

Phone:    ConnectScreen → "Scan QR" button → camera opens →
          scans QR → auto-fills host/port/token → ready to connect
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Terminal pairing | N/A | `navetted --pair` prints QR, exits | No daemon started |
| ConnectScreen | Manual text entry only | "Scan QR" button + manual entry | QR fills form, user taps Connect |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `src/main.rs` | 63-68 | Entry point — insert --pair check before daemon startup |
| P0 | `src/config.rs` | 19-27, 29-40 | Config struct + load_or_create() signature |
| P0 | `mobile/src/screens/ConnectScreen.tsx` | 41-170, 289-308 | Form state + connect flow |
| P1 | `mobile/src/types/index.ts` | 98-103 | ServerConfig type |
| P1 | `Cargo.toml` | 18-33 | Current dependencies |
| P2 | `mobile/package.json` | all | Current mobile dependencies |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| `qrcode` crate | crates.io/crates/qrcode | `QrCode::new(data)` → render to string with `.render::<char>().build()` for terminal output |
| `local-ip-address` crate | crates.io/crates/local-ip-address | `local_ip()` returns `Result<IpAddr>` for the primary interface |
| `expo-camera` / `expo-barcode-scanner` | Expo docs | `expo-camera` (SDK 51+) has built-in barcode scanning via `onBarcodeScanned`; `expo-barcode-scanner` is deprecated |

---

## Patterns to Mirror

### CLI_ENTRY_POINT
// SOURCE: src/main.rs:63-68
```rust
#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt::init();
    let cfg = Arc::new(config::load_or_create()?);
    tracing::info!(ws_port = cfg.ws_port, "config loaded");
```
The `--pair` flag must be checked before the tokio runtime does daemon work. Since the binary has no CLI parser, use `std::env::args()`.

### CONFIG_LOADING
// SOURCE: src/config.rs:29-36
```rust
pub fn load_or_create() -> Result<Config> {
    let path = config_path()?;
    if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        let table: toml::Table = toml::from_str(&content)?;
```
Config is loaded synchronously. The `--pair` path can call this directly.

### ERROR_HANDLING
// SOURCE: src/config.rs:37-40
```rust
let token = table.get("token").and_then(|v| v.as_str())
    .context("missing 'token' in config")?
```
Uses anyhow `.context()` for all error propagation.

### MOBILE_CONNECT_FLOW
// SOURCE: mobile/src/screens/ConnectScreen.tsx:160-167
```typescript
const handleConnect = () => {
    onConnect({
      host: host.trim(),
      port: port.trim(),
      token: token.trim(),
      container: container.trim() || undefined,
    });
};
```
QR scan result should call the same `onConnect` path after filling the form state.

### TEST_STRUCTURE
// SOURCE: src/db.rs (tests module)
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_name() { ... }
}
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `Cargo.toml` | UPDATE | Add `qrcode`, `base64`, `local-ip-address` dependencies |
| `src/main.rs` | UPDATE | Add `--pair` flag handling before daemon startup |
| `mobile/src/screens/ConnectScreen.tsx` | UPDATE | Add "Scan QR" button with camera barcode scanner |
| `mobile/package.json` | UPDATE | Add `expo-camera` dependency (if not present) |
| `mobile/app.json` | UPDATE | Add camera permission (if not present) |

## NOT Building

- QR scanning on web — mobile only
- `pair` WS command — the auth-pairing plan mentions it but it's low-value (you already have the token if you're connected); defer to a later PR
- Tailscale integration with QR — out of scope
- Multi-IP selection UI on daemon side — just show the primary IP; user can override host on the phone

---

## Step-by-Step Tasks

### Task 1: Add Rust dependencies
- **ACTION**: Add `qrcode`, `base64`, and `local-ip-address` crates to Cargo.toml
- **IMPLEMENT**: Add three lines to `[dependencies]`:
  ```toml
  qrcode = "0.14"
  base64 = "0.22"
  local-ip-address = "0.6"
  ```
- **MIRROR**: Existing dependency style in Cargo.toml (version strings, no features unless needed)
- **IMPORTS**: N/A
- **GOTCHA**: Check `local-ip-address` latest version — may be 0.6.x. The crate works on Linux/macOS. On Flatpak/container the IP may be wrong — acceptable for now.
- **VALIDATE**: `cargo check` succeeds

### Task 2: Implement `--pair` handler in main.rs
- **ACTION**: Add a `--pair` early-exit path before daemon startup in `main()`, and a `handle_pair()` function
- **IMPLEMENT**:
  ```rust
  // At the top of main(), before tracing init:
  if std::env::args().any(|a| a == "--pair") {
      return handle_pair();
  }
  
  // New function (not async, no tokio needed):
  fn handle_pair() -> Result<()> {
      let cfg = config::load_or_create()?;
      let local_ip = local_ip_address::local_ip()
          .map(|ip| ip.to_string())
          .unwrap_or_else(|_| "127.0.0.1".to_string());
      let hostname = hostname::get()
          .ok()
          .and_then(|h| h.into_string().ok())
          .unwrap_or_else(|| "navetted".to_string());
      
      let payload = serde_json::json!({
          "host": local_ip,
          "port": cfg.ws_port.to_string(),
          "token": cfg.token,
      });
      let json = serde_json::to_string(&payload)?;
      let encoded = base64::engine::general_purpose::STANDARD.encode(&json);
      let uri = format!("navette://{encoded}");
      
      let qr = qrcode::QrCode::new(uri.as_bytes())
          .context("failed to generate QR code")?;
      let rendered = qr.render::<char>()
          .quiet_zone(true)
          .module_dimensions(2, 1)
          .build();
      
      println!("\n{rendered}");
      println!("  Scan with the navette app to connect.");
      println!("  Host: {local_ip}  Port: {}  Hostname: {hostname}\n", cfg.ws_port);
      Ok(())
  }
  ```
- **MIRROR**: CLI_ENTRY_POINT, CONFIG_LOADING, ERROR_HANDLING patterns
- **IMPORTS**: `use base64::Engine as _;` at the top of main.rs (for `.encode()` method), plus `use anyhow::Context;` (already imported via anyhow::Result)
- **GOTCHA**: `base64` 0.22 requires the `Engine` trait import for `.encode()`. Use `general_purpose::STANDARD`. Don't use the deprecated `base64::encode()`. Also: `hostname::get()` is from `std::env` — actually it's `gethostname` which is in `std` as `hostname::get` — use `gethostname::gethostname()` or just omit hostname and use the IP. Simplest: skip hostname, just show IP+port.
- **VALIDATE**: `cargo build && ./target/debug/navetted --pair` prints a QR code

### Task 3: Add mobile expo-camera dependency
- **ACTION**: Check if `expo-camera` is already in mobile/package.json. If not, add it.
- **IMPLEMENT**: `cd mobile && npx expo install expo-camera`
- **MIRROR**: N/A — expo install handles versioning
- **IMPORTS**: N/A
- **GOTCHA**: `expo-camera` replaced `expo-barcode-scanner` in SDK 51+. Check which Expo SDK version the project uses. The `onBarcodeScanned` prop on `CameraView` is the scanner entry point.
- **VALIDATE**: `cd mobile && npx expo doctor` or `npx tsc --noEmit`

### Task 4: Add QR scanner to ConnectScreen
- **ACTION**: Add a "Scan QR" button and a camera modal to ConnectScreen that decodes the `navette://` payload and fills the form
- **IMPLEMENT**:
  - Add state: `qrVisible`, `cameraPermission`
  - Add "Scan QR" button between the title/subtitle and the saved configs section
  - Modal with `CameraView` from `expo-camera`, `barcodeScannerSettings` for QR type
  - `onBarcodeScanned` handler:
    1. Parse the scanned data — expect `navette://<base64>`
    2. Base64-decode → JSON parse → extract `host`, `port`, `token`
    3. Fill form state (`setHost`, `setPort`, `setToken`)
    4. Close modal
    5. Auto-generate a name from host (e.g., "QR: 192.168.1.5")
  - Handle permissions: request camera permission on button press; show error if denied
- **MIRROR**: MOBILE_CONNECT_FLOW pattern, existing modal patterns (tsPeerVisible modal)
- **IMPORTS**: `import { CameraView, useCameraPermissions } from 'expo-camera';` and standard `atob` or a base64 decode polyfill
- **GOTCHA**: 
  - `atob` exists in React Native's JS engine (Hermes) since RN 0.74. If older, use `Buffer.from(data, 'base64').toString()` from `buffer` polyfill or a manual decode.
  - `onBarcodeScanned` fires repeatedly — use a `scannedRef` to debounce and only process once.
  - Camera permission must be requested at runtime on both iOS and Android.
  - The `navette://` prefix is important — validate it before decoding to avoid processing random QR codes.
- **VALIDATE**: `cd mobile && npx tsc --noEmit` clean

### Task 5: Add camera permission to app.json (if needed)
- **ACTION**: Check mobile/app.json for camera permission. Add if missing.
- **IMPLEMENT**: Under `expo.plugins`, add `["expo-camera"]` if not present. Under `expo.android.permissions`, ensure `CAMERA` is listed. Under `expo.ios.infoPlistRaw` or similar, ensure `NSCameraUsageDescription` is set.
- **MIRROR**: Existing app.json structure
- **IMPORTS**: N/A
- **GOTCHA**: expo-camera's config plugin usually handles this automatically when you add it to plugins.
- **VALIDATE**: Check app.json has the permission entries

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `pair_payload_is_valid_json` | Config with known token/port | JSON with host, port, token fields | No |
| `pair_payload_base64_roundtrip` | Generated payload | Decode matches original JSON | No |
| `qr_code_renders_without_panic` | Valid URI string | Non-empty rendered string | No |

### Edge Cases Checklist
- [ ] No config file exists → `load_or_create()` creates one, `--pair` still works
- [ ] No network interfaces → `local_ip()` fails → fallback to "127.0.0.1"
- [ ] Scanned QR is not a navette:// URI → ignore/show error, don't crash
- [ ] Scanned QR has malformed base64 → show error toast
- [ ] Scanned QR has valid base64 but invalid JSON → show error toast
- [ ] Camera permission denied → show clear message, don't block manual entry
- [ ] Very long token (edge case) → QR code still fits terminal width

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
EXPECT: All tests pass (existing 37 + new)

### TypeScript
```bash
cd mobile && npx tsc --noEmit
```
EXPECT: Zero type errors

### Manual Validation
- [ ] `navetted --pair` prints readable QR code to terminal
- [ ] QR code scans successfully with phone camera (test with any QR reader first)
- [ ] navette app "Scan QR" button opens camera
- [ ] Scanning the terminal QR fills host/port/token in the form
- [ ] Tapping Connect after scan works as expected
- [ ] Camera permission denial shows helpful message
- [ ] `navetted` (without --pair) starts normally as before

---

## Acceptance Criteria
- [ ] `navetted --pair` prints a scannable QR to terminal and exits
- [ ] QR payload contains host (local IP), port, and token
- [ ] Mobile app has "Scan QR" button on ConnectScreen
- [ ] Scanning fills the connection form automatically
- [ ] All tests pass, clippy clean, tsc clean
- [ ] Camera permission handled gracefully

## Completion Checklist
- [ ] Code follows discovered patterns
- [ ] Error handling uses anyhow .context()
- [ ] No hardcoded values
- [ ] No unnecessary scope additions
- [ ] Self-contained — no questions needed during implementation

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| `local-ip-address` returns wrong IP in Flatpak/container | Medium | Low | User can edit host in form after scan; show IP in terminal output |
| `expo-camera` version incompatibility with project's Expo SDK | Low | Medium | Use `npx expo install` which picks compatible version |
| Hermes engine missing `atob` | Low | Medium | Check RN version; add polyfill if needed |

## Notes
- The `navette://` URI scheme is a convention for this app — not registered system-wide. It's just a prefix to identify navette QR codes vs random ones.
- Port is transmitted as string to match `ServerConfig.port` type on the mobile side.
- The auth-pairing plan mentions a `pair` WS command for re-sharing — deferred to a later PR since it's low-value (connected clients already have the token).
