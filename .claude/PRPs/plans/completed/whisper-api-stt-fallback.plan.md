# Plan: Whisper API Fallback for STT

## Summary
Add a cloud-based Whisper API fallback for speech-to-text when on-device STT (Google Soda) fails or is unavailable. Records audio via expo-av, sends it to the OpenAI Whisper endpoint, and returns transcribed text. Requires API key configuration in Settings.

## User Story
As a mobile user whose device lacks on-device STT support,
I want a cloud-based speech-to-text fallback,
So that I can still use voice input to control my agent sessions.

## Problem → Solution
On-device STT (Soda) is unavailable on some devices or broken on certain Android versions → Whisper API provides a reliable cloud fallback with API key config in settings.

## Metadata
- **Complexity**: Medium
- **Source PRD**: ROADMAP.md backlog
- **PRD Phase**: N/A
- **Estimated Files**: 5-8

---

## UX Design

### Before
```
┌─────────────────────────────┐
│  Mic button → on-device STT │
│  If Soda unavailable: no    │
│  voice input possible       │
└─────────────────────────────┘
```

### After
```
┌─────────────────────────────┐
│  Mic button → on-device STT │
│  If Soda fails/unavailable: │
│  → Record audio via expo-av │
│  → POST to Whisper endpoint │
│  → Return transcription     │
│                             │
│  Settings: Whisper API key  │
│  input field + test button  │
└─────────────────────────────┘
```

### Interaction Changes
| Touchpoint | Before | After | Notes |
|---|---|---|---|
| Mic button (no Soda) | Button disabled or fails | Records audio, sends to Whisper | Automatic fallback |
| Settings screen | No Whisper config | "Whisper API Key" text input + test button | New section |
| Voice feedback | Only on-device indicators | Cloud indicator when using Whisper | User knows it's cloud-based |

---

## Mandatory Reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `mobile/src/components/VoiceButton.tsx` | all | Current STT implementation — must integrate fallback here |
| P0 | `mobile/src/screens/SettingsScreen.tsx` | all | Where API key config goes |
| P1 | `mobile/src/hooks/useClaudedWS.ts` | all | How text is sent to daemon (sendInput) |
| P1 | `mobile/src/types/index.ts` | all | Existing type definitions |
| P2 | `mobile/src/components/__tests__/VoiceButton.test.tsx` | all | Existing test patterns |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| OpenAI Whisper API | OpenAI API docs | POST multipart/form-data to /v1/audio/transcriptions; accepts m4a, wav, mp3 |
| expo-av Recording | Expo docs | Audio.Recording class; records to local file URI; supports m4a |
| AsyncStorage | @react-native-async-storage/async-storage | Persist API key locally |

---

## Patterns to Mirror

### NAMING_CONVENTION
// SOURCE: mobile/src/components/VoiceButton.tsx
PascalCase components, camelCase functions, `use` prefix for hooks.

### ERROR_HANDLING
// SOURCE: mobile/src/components/VoiceButton.tsx
Try-catch around STT operations; errors logged to console.warn; user sees status text.

### SETTINGS_PATTERN
// SOURCE: mobile/src/screens/SettingsScreen.tsx
Sections with labels and controls; AsyncStorage for persistence.

### TEST_STRUCTURE
// SOURCE: mobile/src/components/__tests__/VoiceButton.test.tsx
Jest tests in __tests__/ directories; mock native modules.

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `mobile/src/components/VoiceButton.tsx` | UPDATE | Add Whisper fallback logic when Soda unavailable |
| `mobile/src/screens/SettingsScreen.tsx` | UPDATE | Add Whisper API key input section |
| `mobile/src/hooks/useWhisper.ts` | CREATE | Hook: record audio via expo-av, POST to Whisper, return text |
| `mobile/src/types/index.ts` | UPDATE | Add WhisperConfig type if needed |
| `mobile/package.json` | UPDATE | Add expo-av if not already present |
| `mobile/src/components/__tests__/VoiceButton.test.tsx` | UPDATE | Add tests for fallback path |

## NOT Building

- Custom Whisper server / self-hosted Whisper (just OpenAI endpoint for now)
- Streaming transcription (batch only — record then transcribe)
- Automatic language detection UI (Whisper auto-detects)
- Replacing on-device STT — this is fallback only

---

## Step-by-Step Tasks

### Task 1: Add expo-av dependency
- **ACTION**: Install expo-av for audio recording
- **IMPLEMENT**: `npx expo install expo-av`
- **MIRROR**: Existing expo-* dependency patterns in package.json
- **IMPORTS**: `import { Audio } from 'expo-av'`
- **GOTCHA**: expo-av requires microphone permission — already granted for on-device STT
- **VALIDATE**: Package installs without conflicts

### Task 2: Create useWhisper hook
- **ACTION**: Create a hook that records audio and transcribes via Whisper API
- **IMPLEMENT**: 
  - `startRecording()`: configure Audio.Recording with m4a preset, start recording
  - `stopAndTranscribe()`: stop recording, get file URI, POST multipart to Whisper endpoint, return text
  - Load API key from AsyncStorage
  - Return `{ isRecording, transcript, error, startRecording, stopAndTranscribe }`
- **MIRROR**: useClaudedWS hook patterns (state + functions returned)
- **IMPORTS**: `expo-av`, `@react-native-async-storage/async-storage`
- **GOTCHA**: Must handle recording permissions; file URI format varies by platform; m4a is most compatible
- **VALIDATE**: Hook can record 5s of audio and return transcription

### Task 3: Integrate fallback into VoiceButton
- **ACTION**: When on-device STT is unavailable or fails, fall back to Whisper
- **IMPLEMENT**:
  - Check if API key is configured (AsyncStorage)
  - If Soda unavailable AND key exists: use useWhisper instead
  - Show "Cloud" indicator when using Whisper
  - Feed transcribed text to the same `onTranscript` callback
- **MIRROR**: Existing VoiceButton state machine (tap-to-toggle pattern)
- **IMPORTS**: useWhisper hook
- **GOTCHA**: User expects tap-to-toggle behavior for both modes; must not change to push-to-talk (see memory: feedback-voice-button-tap-to-toggle)
- **VALIDATE**: Voice button works with both Soda and Whisper paths

### Task 4: Add Settings UI for API key
- **ACTION**: Add Whisper configuration section to SettingsScreen
- **IMPLEMENT**:
  - "Voice" or "Speech" section header
  - TextInput for Whisper API key (secureTextEntry)
  - "Test" button that records 2s and transcribes
  - Save to AsyncStorage key `whisper_api_key`
- **MIRROR**: Existing SettingsScreen section patterns (ntfy section)
- **IMPORTS**: AsyncStorage, TextInput
- **GOTCHA**: Don't expose the full key in UI after saving — show masked version
- **VALIDATE**: Key persists across app restarts; test button returns transcription

### Task 5: Update tests
- **ACTION**: Add test coverage for Whisper fallback
- **IMPLEMENT**: Mock expo-av and fetch; test fallback activation, recording, transcription flow
- **MIRROR**: Existing VoiceButton test patterns
- **IMPORTS**: jest mocks
- **GOTCHA**: expo-av must be mocked; fetch for Whisper endpoint must be mocked
- **VALIDATE**: All tests pass

---

## Testing Strategy

### Unit Tests
| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| useWhisper records audio | startRecording() | isRecording = true | No |
| useWhisper transcribes | stopAndTranscribe() | transcript returned | No |
| VoiceButton falls back to Whisper | Soda unavailable + key set | Uses Whisper hook | Yes |
| VoiceButton disabled without both | Soda unavailable + no key | Button disabled | Yes |
| Settings saves API key | Enter key + save | Key in AsyncStorage | No |
| Whisper API error | 401 response | Error message shown | Yes |

### Edge Cases Checklist
- [ ] No API key configured — Whisper fallback disabled, on-device only
- [ ] Invalid API key — clear error message
- [ ] Network failure during transcription — error shown, recording cleaned up
- [ ] Very short recording (<1s) — handle gracefully
- [ ] Very long recording (>60s) — enforce max duration
- [ ] Soda available — never uses Whisper (on-device preferred)

---

## Validation Commands

### Unit Tests
```bash
cd mobile && npx jest
```
EXPECT: All tests pass

### Type Check
```bash
cd mobile && npx tsc --noEmit
```
EXPECT: No type errors

### Manual Validation
- [ ] On device with Soda: mic button uses on-device STT (no change)
- [ ] On device without Soda + API key: mic button records then transcribes via Whisper
- [ ] Settings: can enter, save, and test Whisper API key
- [ ] No API key: voice button falls back gracefully

---

## Acceptance Criteria
- [ ] Whisper fallback works when on-device STT unavailable
- [ ] API key configurable in Settings with test button
- [ ] Tap-to-toggle UX preserved for both modes
- [ ] On-device STT still preferred when available
- [ ] Tests written and passing
- [ ] No API key leaked in logs or UI

## Completion Checklist
- [ ] Code follows discovered patterns
- [ ] Error handling matches codebase style
- [ ] Tests follow test patterns
- [ ] No hardcoded values
- [ ] API key stored securely (AsyncStorage, masked in UI)

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| expo-av recording quality too low | Low | Medium | Use high-quality m4a preset |
| Whisper API latency too high | Medium | Medium | Show loading indicator; document that cloud is slower |
| User confusion between modes | Low | Low | Show "Cloud" badge when using Whisper |

## Notes
- User has explicitly rejected Whisper as a *replacement* for on-device STT (see memory: feedback-no-cloud-stt-fallback). This PR positions it as a fallback only, not a replacement — on-device is always preferred when available.
- No daemon changes needed — all mobile-side.
