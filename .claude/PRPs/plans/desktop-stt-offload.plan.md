# Plan: Desktop-Offloaded STT via Rust Daemon (whisper.cpp + CUDA)

## Summary

Phone records audio, streams base64 PCM chunks over the existing `clauded` WebSocket to a Rust STT service backed by `whisper-rs` with CUDA. Daemon broadcasts transcripts back as WS events. Leverages your 4090/5090 instead of the phone CPU — quality and speed far beyond anything on-device.

## User Story

As a user on the same LAN (or Tailnet) as my desktop, I want to press the mic on my phone and get desktop-grade Whisper transcription streamed back, so I never hit Google's rate-limited cloud STT and don't depend on the phone's on-device model quality.

## Problem → Solution

**Current**: phone-only STT → Google cloud (rate-limited, offline-flaky) or on-device (mediocre quality, English-only, no domain vocab).
**Desired**: phone streams audio → desktop whisper.cpp-CUDA → transcript back in < 1s end-to-end on LAN.

## Metadata

- **Complexity**: Large (4–8 hours focused)
- **Risk**: Medium — new Rust crate + audio streaming + mobile audio pipeline
- **Fallback**: existing PREFER_OFFLINE path already shipped tonight (smallest win)

---

## Scope Decision: LAN vs Anywhere

| Mode | Reach | Latency | Setup |
|---|---|---|---|
| LAN-only | Same wifi as desktop | 200–600ms | Default — works today since clauded binds 0.0.0.0:7878 |
| Tailnet | Anywhere via Tailscale | 400–900ms | Install Tailscale on phone + desktop, connect to MagicDNS hostname |
| Cloud fallback | Anywhere, no desktop | 600–1500ms | Use Groq Whisper API (free tier, fast) as third path |

This plan covers **LAN/Tailnet**. Groq fallback is a separate ~1h task.

---

## Rust Daemon Changes

### New crate dep in `Cargo.toml`

```toml
whisper-rs = { version = "0.13", features = ["cuda"] }
base64 = "0.22"
```

Model file: `ggml-base.en.bin` (~148MB) or `ggml-small.en.bin` (~488MB) downloaded on first daemon start to `~/.clauded/models/`. `ggml-small.en` gives near-perfect transcripts for English conversational speech.

### New module `src/stt.rs`

```rust
use whisper_rs::{WhisperContext, WhisperContextParameters, FullParams, SamplingStrategy};
use std::sync::Arc;
use tokio::sync::Mutex;
use base64::{Engine, engine::general_purpose::STANDARD};

pub struct SttEngine {
    ctx: Arc<WhisperContext>,
}

pub struct SttSession {
    pcm_buf: Vec<f32>,     // accumulates 16kHz mono f32 samples
    sample_rate: u32,
    started_at: f64,
}

impl SttEngine {
    pub fn new(model_path: &str) -> anyhow::Result<Self> {
        let params = WhisperContextParameters::default();
        let ctx = WhisperContext::new_with_params(model_path, params)?;
        Ok(Self { ctx: Arc::new(ctx) })
    }

    pub fn transcribe(&self, pcm: &[f32]) -> anyhow::Result<String> {
        let mut state = self.ctx.create_state()?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_translate(false);
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);
        state.full(params, pcm)?;
        let mut out = String::new();
        for i in 0..state.full_n_segments()? {
            out.push_str(&state.full_get_segment_text(i)?);
        }
        Ok(out.trim().to_string())
    }
}

pub type SttSessions = Arc<Mutex<std::collections::HashMap<String, SttSession>>>;

pub fn decode_pcm_chunk(b64: &str) -> anyhow::Result<Vec<i16>> {
    let bytes = STANDARD.decode(b64)?;
    let samples: Vec<i16> = bytes
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]))
        .collect();
    Ok(samples)
}

pub fn i16_to_f32(samples: &[i16]) -> Vec<f32> {
    samples.iter().map(|&s| s as f32 / 32768.0).collect()
}
```

### `src/ws.rs` new message types

Add to the `msg_type` match chain around line 192:

```rust
"stt_start" => {
    let stt_id = v["stt_id"].as_str().unwrap_or("").to_string();
    let sample_rate = v["sample_rate"].as_u64().unwrap_or(16000) as u32;
    stt_sessions.lock().await.insert(stt_id.clone(), SttSession {
        pcm_buf: Vec::with_capacity(sample_rate as usize * 30),
        sample_rate,
        started_at: unix_ts(),
    });
    send_json(&mut socket, &serde_json::json!({
        "type": "stt_started",
        "stt_id": stt_id,
    })).await?;
}

"stt_audio_chunk" => {
    let stt_id = v["stt_id"].as_str().unwrap_or("");
    let chunk_b64 = v["pcm_b64"].as_str().unwrap_or("");
    if let Ok(samples_i16) = stt::decode_pcm_chunk(chunk_b64) {
        let samples_f32 = stt::i16_to_f32(&samples_i16);
        if let Some(sess) = stt_sessions.lock().await.get_mut(stt_id) {
            sess.pcm_buf.extend_from_slice(&samples_f32);
        }
    }
}

"stt_stop" => {
    let stt_id = v["stt_id"].as_str().unwrap_or("").to_string();
    let sess = stt_sessions.lock().await.remove(&stt_id);
    if let Some(sess) = sess {
        let engine = stt_engine.clone();
        let tx = events_tx.clone();
        tokio::spawn(async move {
            let result = tokio::task::spawn_blocking(move || {
                engine.transcribe(&sess.pcm_buf)
            }).await;
            let transcript = match result {
                Ok(Ok(t)) => t,
                Ok(Err(e)) => { tracing::error!(error = %e, "stt transcribe"); String::new() }
                Err(e) => { tracing::error!(error = %e, "stt join"); String::new() }
            };
            let _ = tx.send((0, unix_ts(), serde_json::json!({
                "type": "stt_transcript",
                "stt_id": stt_id,
                "text": transcript,
                "duration_ms": ((unix_ts() - sess.started_at) * 1000.0) as u64,
            }).to_string()));
        });
    }
}
```

### `src/main.rs` bootstrap

```rust
let model_path = format!("{}/.clauded/models/ggml-small.en.bin", std::env::var("HOME")?);
let stt_engine = Arc::new(stt::SttEngine::new(&model_path)?);
let stt_sessions: stt::SttSessions = Arc::new(Mutex::new(HashMap::new()));
// Pass into ws::serve alongside sessions, events_tx, etc.
```

---

## Mobile Changes

### `package.json` already has `expo-av`

Verify with `npm ls expo-av`. If missing: `npx expo install expo-av`.

### `mobile/src/components/VoiceButton.tsx` — add third handler

```typescript
import { Audio } from 'expo-av';
import * as FileSystem from 'expo-file-system';

const handlePressDesktopOffload = async () => {
  const sttId = `stt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // 1. Permission
  const { status } = await Audio.requestPermissionsAsync();
  if (status !== 'granted') {
    showErr('Microphone permission denied', 0, true, 'permission');
    return;
  }

  // 2. Start WS session
  send({ type: 'stt_start', stt_id: sttId, sample_rate: 16000 });

  // 3. Record with linear PCM
  await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync({
    android: {
      extension: '.wav',
      outputFormat: Audio.RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_DEFAULT,
      audioEncoder: Audio.RECORDING_OPTION_ANDROID_AUDIO_ENCODER_DEFAULT,
      sampleRate: 16000,
      numberOfChannels: 1,
      bitRate: 256000,
    },
    ios: { /* ... linear PCM 16kHz mono ... */ },
    web: {},
  });
  await recording.startAsync();
  recordingRef.current = recording;
  setState('recording');

  // On stop: read file, chunk, base64, send, then stt_stop
  onStopRef.current = async () => {
    await recording.stopAndUnloadAsync();
    const uri = recording.getURI();
    if (!uri) return;
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    // Strip WAV header (44 bytes) before send — or send whole and strip server-side
    const CHUNK = 32 * 1024; // 32KB base64 chunks
    for (let i = 0; i < b64.length; i += CHUNK) {
      send({
        type: 'stt_audio_chunk',
        stt_id: sttId,
        pcm_b64: b64.slice(i, i + CHUNK),
      });
    }
    send({ type: 'stt_stop', stt_id: sttId });
    setState('processing');
  };
};
```

### `mobile/src/hooks/useClaudedWS.ts` — handle `stt_transcript`

```typescript
case 'stt_transcript': {
  onTranscriptRef.current?.(v.text);
  break;
}
```

### Mode selection UI

Add a `stt_mode` user pref in Settings: `on-device | desktop | cloud`. Mic button reads pref, routes to correct handler. Default to `desktop` when connected, `on-device` otherwise.

---

## Files to Change

| File | Action | Why |
|---|---|---|
| `Cargo.toml` | UPDATE | Add whisper-rs + base64 |
| `src/stt.rs` | CREATE | Whisper engine + session buffer |
| `src/ws.rs` | UPDATE | stt_start/stt_audio_chunk/stt_stop messages |
| `src/main.rs` | UPDATE | Bootstrap SttEngine, pass to ws::serve |
| `src/config.rs` | UPDATE | Add `stt_model_path`, `stt_enabled` config fields |
| `mobile/src/components/VoiceButton.tsx` | UPDATE | Add handlePressDesktopOffload |
| `mobile/src/hooks/useClaudedWS.ts` | UPDATE | Handle stt_transcript event |
| `mobile/src/screens/SettingsScreen.tsx` | UPDATE | STT mode selector |
| `mobile/src/types/index.ts` | UPDATE | Add STT message + event types |

## NOT Building

- Real-time streaming transcription (we send the full recording at stop — simpler, still < 1s for typical voice queries)
- VAD / silence trimming (whisper.cpp handles padding fine)
- Multi-language support (English only v1)
- Speaker diarization
- Model download UI (manual `curl` + path in config for v1)

---

## Step-by-Step Tasks

1. **Add deps**: `cargo add whisper-rs --features cuda && cargo add base64`. Verify CUDA toolkit via `nvcc --version`.
2. **Download model**: `curl -L https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin -o ~/.clauded/models/ggml-small.en.bin`
3. **Create `src/stt.rs`**: copy module above, unit test with a known-good WAV.
4. **Wire `main.rs` bootstrap**: build SttEngine once at startup, share via Arc.
5. **Update `ws.rs`**: add 3 message handlers + `stt_transcript` broadcast.
6. **Update `config.rs`**: add STT section with model path + enabled flag.
7. **Mobile: audio recording**: add `expo-av` import path in VoiceButton.
8. **Mobile: chunker**: read file, base64 encode, split into 32KB chunks, send sequentially.
9. **Mobile: stt_transcript handler**: wire to `onTranscriptRef` same as Google path.
10. **Settings UI**: radio group for STT mode.
11. **End-to-end test on LAN**: start daemon, connect phone, record 3s of speech, verify transcript latency.
12. **Tailscale test**: repeat from cellular.

---

## Validation

```bash
# Rust
cargo build --release
cargo test -p clauded -- stt::

# Mobile
cd mobile && npx tsc --noEmit
cd mobile/android && ./gradlew assembleDebug

# Manual end-to-end
./target/release/clauded &
# Install APK, configure WS URL, press mic, speak, verify transcript in < 1.5s
```

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| whisper-rs CUDA build flakes | High — blocks everything | Fallback to CPU feature; 5090 still does small.en in ~200ms CPU |
| WAV header not stripped server-side | Med — bad samples at start | Strip first 44 bytes in `decode_pcm_chunk` if starts with "RIFF" |
| Phone on slow cellular | Med — upload takes > transcript | Cap recording at 30s; add progress indicator |
| Model file missing on first run | High — daemon crashes | Download-on-start helper in main.rs with progress log |
| Concurrent STT sessions OOM the GPU | Low — you're the only user | Add semaphore (max 2 concurrent) |

---

## Tonight's State (already shipped)

- `VoiceButton.tsx` line 360–369: `requiresOnDeviceRecognition: true` + `EXTRA_PREFER_OFFLINE: true`
- Typecheck clean
- `app-debug.apk` rebuilt at `mobile/android/app/build/outputs/apk/debug/app-debug.apk`

## Morning Ask

Approve this plan (or trim scope — e.g., skip Settings UI, hardcode desktop mode), and I'll execute. Expect 4–6 hours to a working LAN demo, plus 1h Tailscale polish.
