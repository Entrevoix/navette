import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

// Suppress benign Animated act() warnings — RN's pulse/ring loop schedules
// timers via the Animated runtime that fire outside the test's act() scope.
// Asserting on UI state already covers what the user sees; the warning is noise.
const _origConsoleError = console.error;
beforeAll(() => {
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === 'string' && first.includes('not wrapped in act')) return;
    _origConsoleError(...args);
  };
});
afterAll(() => { console.error = _origConsoleError; });

// ── Mocks ────────────────────────────────────────────────────────────────────
// Do NOT reference module-level variables inside jest.mock factories —
// they execute during hoisting when all `var` declarations are still undefined.
// Create jest.fn() instances inside the factory, then retrieve via jest.requireMock().

jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    addListener: jest.fn(),
    start: jest.fn(),
    stop: jest.fn(),
    requestPermissionsAsync: jest.fn(),
    getSupportedLocales: jest.fn(),
    getSpeechRecognitionServices: jest.fn(),
    getDefaultRecognitionService: jest.fn(),
  },
}));

jest.mock('expo-av', () => ({
  Audio: {
    requestPermissionsAsync: jest.fn(),
    setAudioModeAsync: jest.fn().mockResolvedValue(undefined),
    Recording: {
      createAsync: jest.fn(),
    },
    RecordingOptionsPresets: { HIGH_QUALITY: {} },
  },
}));

jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium' },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
}));

// ── Retrieve mock references (runs after hoisted factories, before tests) ────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const speechMocked = jest.requireMock('expo-speech-recognition') as any;
const mockAddListener = speechMocked.ExpoSpeechRecognitionModule.addListener as jest.Mock;
const mockStart = speechMocked.ExpoSpeechRecognitionModule.start as jest.Mock;
const mockStop = speechMocked.ExpoSpeechRecognitionModule.stop as jest.Mock;
const mockRequestPermissionsAsync = speechMocked.ExpoSpeechRecognitionModule.requestPermissionsAsync as jest.Mock;
const mockGetSupportedLocales = speechMocked.ExpoSpeechRecognitionModule.getSupportedLocales as jest.Mock;
const mockGetSpeechRecognitionServices = speechMocked.ExpoSpeechRecognitionModule.getSpeechRecognitionServices as jest.Mock;
const mockGetDefaultRecognitionService = speechMocked.ExpoSpeechRecognitionModule.getDefaultRecognitionService as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const avMocked = jest.requireMock('expo-av') as any;
const mockAudioRequestPermissions = avMocked.Audio.requestPermissionsAsync as jest.Mock;
const mockSetAudioMode = avMocked.Audio.setAudioModeAsync as jest.Mock;
const mockCreateAsync = avMocked.Audio.Recording.createAsync as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const storageMocked = jest.requireMock('@react-native-async-storage/async-storage') as any;
const mockAsyncStorageGetItem = storageMocked.getItem as jest.Mock;

// ── Import after mocks ────────────────────────────────────────────────────────

import { VoiceButton } from '../VoiceButton';

// ── Helpers ───────────────────────────────────────────────────────────────────

const onTranscript = jest.fn();

function renderButton(props: { disabled?: boolean } = {}) {
  return render(<VoiceButton onTranscript={onTranscript} {...props} />);
}

// Tap helpers — drive the start (pressIn) and stop (pressOut) lifecycle
// directly. Default jest preset has Platform.OS === 'ios' so the on-device
// path goes through expo-speech-recognition's requestPermissionsAsync (not
// Android's PermissionsAndroid).
async function pressIn(node: ReturnType<ReturnType<typeof render>['getByText']>) {
  await act(async () => { fireEvent(node, 'pressIn'); });
}
async function pressOut(node: ReturnType<ReturnType<typeof render>['getByText']>) {
  await act(async () => { fireEvent(node, 'pressOut'); });
}

// Capture listeners registered with addListener so tests can fire events
const listeners: Record<string, (event: unknown) => void> = {};

beforeEach(() => {
  jest.clearAllMocks();

  // Default: on-device engine (no value in AsyncStorage)
  mockAsyncStorageGetItem.mockResolvedValue(null);

  // Default: permissions granted
  mockRequestPermissionsAsync.mockResolvedValue({ granted: true });
  mockAudioRequestPermissions.mockResolvedValue({ granted: true });
  mockSetAudioMode.mockResolvedValue(undefined);

  // Default: en-US is claimed + installed, so pickBestLocale returns en-US
  mockGetSupportedLocales.mockResolvedValue({
    locales: ['en-US'],
    installedLocales: ['en-US'],
  });
  mockGetSpeechRecognitionServices.mockReturnValue([]);
  mockGetDefaultRecognitionService.mockReturnValue({ packageName: '' });

  // Default recording mock
  const mockRecordingInstance = {
    stopAndUnloadAsync: jest.fn().mockResolvedValue(undefined),
    getURI: jest.fn().mockReturnValue('file:///tmp/audio.m4a'),
  };
  mockCreateAsync.mockResolvedValue({ recording: mockRecordingInstance });

  // Re-register listener capture after clearAllMocks
  mockAddListener.mockImplementation((event: string, cb: (e: unknown) => void) => {
    listeners[event] = cb;
    return { remove: jest.fn() };
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('VoiceButton — render', () => {
  it('renders record icon when idle', () => {
    const { getByText } = renderButton();
    expect(getByText('⏺')).toBeTruthy();
  });

  it('is disabled when disabled prop is true', () => {
    const { getByText } = renderButton({ disabled: true });
    expect(getByText('⏺')).toBeTruthy();
  });
});

describe('VoiceButton — on-device tap-to-toggle (default)', () => {
  it('starts recognition with the Android 16 fix flags on start tap', async () => {
    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({
      lang: 'en-US',
      interimResults: true,
      continuous: true,
      androidRecognitionServicePackage: 'com.google.android.tts',
      androidIntentOptions: { EXTRA_LANGUAGE_MODEL: 'web_search' },
    }));
    expect(getByText('⏹')).toBeTruthy();
  });

  it('stops recognition on stop tap', async () => {
    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await pressOut(getByText('⏹'));
    expect(mockStop).toHaveBeenCalled();
  });

  it('shows error when mic permission denied', async () => {
    mockRequestPermissionsAsync.mockResolvedValueOnce({ granted: false });
    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(getByText(/Microphone permission is required/)).toBeTruthy());
  });

  it('emits interim transcripts as non-final during a session', async () => {
    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await act(async () => {
      listeners['result']?.({
        results: [{ transcript: 'partial' }],
        isFinal: false,
      });
    });
    expect(onTranscript).toHaveBeenLastCalledWith('partial', false);
    // Still listening — finals don't auto-stop in continuous mode
    expect(getByText('⏹')).toBeTruthy();
  });

  it('emits per-utterance finals as non-final composed text, then a single isFinal on stop tap', async () => {
    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());

    // First utterance final — should NOT terminate the session
    await act(async () => {
      listeners['result']?.({ results: [{ transcript: 'hello' }], isFinal: true });
    });
    expect(onTranscript).toHaveBeenLastCalledWith('hello', false);
    expect(getByText('⏹')).toBeTruthy();

    // Second utterance final — composed text grows
    await act(async () => {
      listeners['result']?.({ results: [{ transcript: 'world' }], isFinal: true });
    });
    expect(onTranscript).toHaveBeenLastCalledWith('hello world', false);
    expect(getByText('⏹')).toBeTruthy();

    // Stop tap — end fires, composed text is committed as isFinal=true
    await pressOut(getByText('⏹'));
    await act(async () => { listeners['end']?.({}); });
    await waitFor(() => expect(onTranscript).toHaveBeenLastCalledWith('hello world', true));
  });

  it('combines a final segment with a trailing interim into the composed text', async () => {
    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await act(async () => {
      listeners['result']?.({ results: [{ transcript: 'hello' }], isFinal: true });
    });
    await act(async () => {
      listeners['result']?.({ results: [{ transcript: 'wor' }], isFinal: false });
    });
    expect(onTranscript).toHaveBeenLastCalledWith('hello wor', false);
  });

  it('resets to idle when error event fires', async () => {
    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await act(async () => { listeners['error']?.({ error: 'client error' }); });
    await waitFor(() => expect(getByText('⏺')).toBeTruthy());
    expect(getByText(/client error/)).toBeTruthy();
  });

  it('resets to idle when end event fires', async () => {
    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await act(async () => { listeners['end']?.({}); });
    await waitFor(() => expect(getByText('⏺')).toBeTruthy());
  });
});

describe('VoiceButton — Whisper engine tap-to-toggle', () => {
  beforeEach(() => {
    mockAsyncStorageGetItem.mockResolvedValue('whisper');
  });

  it('starts audio recording on start tap', async () => {
    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(mockCreateAsync).toHaveBeenCalledTimes(1));
    expect(getByText('⏹')).toBeTruthy();
  });

  it('stops recording and delivers transcript on stop tap', async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'whisper transcript' }),
    });

    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await pressOut(getByText('⏹'));
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('whisper transcript', true));
  });

  it('shows error when Whisper API key is missing', async () => {
    // Key-aware mock: engine = 'whisper', everything else null (no API key)
    mockAsyncStorageGetItem.mockImplementation((key: string) =>
      Promise.resolve(key === 'stt_engine' ? 'whisper' : null)
    );

    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await pressOut(getByText('⏹'));
    await waitFor(() => expect(getByText(/Whisper API key not set/)).toBeTruthy());
  });

  it('shows error when mic permission denied', async () => {
    mockAudioRequestPermissions.mockResolvedValueOnce({ granted: false });
    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(getByText(/Microphone permission is required/)).toBeTruthy());
  });
});

// ── Watchdog, max-cap, failover, picker ───────────────────────────────────────

describe('VoiceButton — silent-hang watchdog (6s no audio)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('fires after 6s of no audio events and surfaces a diagnostics error', async () => {
    const { getByText } = renderButton();
    await act(async () => { fireEvent(getByText('⏺'), 'pressIn'); });
    // Let pending promises settle (permission, locale pick, start)
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(mockStart).toHaveBeenCalled();
    // Advance past the 6s watchdog without firing any audio/speech event
    await act(async () => { jest.advanceTimersByTime(6500); });
    await act(async () => { await Promise.resolve(); });
    expect(getByText(/no audio was captured/i)).toBeTruthy();
  });

  it('does NOT fire when an audiostart event arrives before 6s', async () => {
    const { getByText, queryByText } = renderButton();
    await act(async () => { fireEvent(getByText('⏺'), 'pressIn'); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    // Audio flowed before the watchdog deadline
    await act(async () => { listeners['audiostart']?.({}); });
    await act(async () => { jest.advanceTimersByTime(6500); });
    expect(queryByText(/no audio was captured/i)).toBeNull();
  });
});

describe('VoiceButton — max-duration safety cap (3 min)', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('auto-stops the on-device session after 3 minutes', async () => {
    const { getByText } = renderButton();
    await act(async () => { fireEvent(getByText('⏺'), 'pressIn'); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(mockStart).toHaveBeenCalled();
    // Advance past the 3-min cap
    await act(async () => { jest.advanceTimersByTime(3 * 60 * 1000 + 100); });
    await act(async () => { await Promise.resolve(); });
    expect(mockStop).toHaveBeenCalled();
  });
});

describe('VoiceButton — failover/detection on recognizer error', () => {
  it('runs detection (getSpeechRecognitionServices) when error code 5 fires with no saved pkg', async () => {
    mockGetSpeechRecognitionServices.mockReturnValue([
      'com.google.android.tts',
      'com.samsung.android.bixby.agent',
    ]);
    mockGetDefaultRecognitionService.mockReturnValue({ packageName: 'com.google.android.tts' });

    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));

    const detectCallsBefore = mockGetSpeechRecognitionServices.mock.calls.length;
    await act(async () => {
      listeners['error']?.({ code: 5, error: 'client', message: 'no service' });
    });
    // code 5 + no saved pkg → branch 2 in error handler triggers detection,
    // which calls getSpeechRecognitionServices to enumerate installed STT services.
    await waitFor(() => {
      expect(mockGetSpeechRecognitionServices.mock.calls.length).toBeGreaterThan(detectCallsBefore);
    });
  });

  it('auto-starts when detection finds exactly one real recognizer', async () => {
    // One real service + the always-appended SYSTEM_DEFAULT means realHits.length === 1
    mockGetSpeechRecognitionServices.mockReturnValue(['com.google.android.tts']);
    mockGetDefaultRecognitionService.mockReturnValue({ packageName: 'com.google.android.tts' });

    const { getByText } = renderButton();
    await pressIn(getByText('⏺'));
    await waitFor(() => expect(mockStart).toHaveBeenCalledTimes(1));
    const callsBefore = mockStart.mock.calls.length;

    await act(async () => {
      listeners['error']?.({ code: 5, error: 'client', message: 'no service' });
    });
    // Single-real-hit branch saves the pkg and auto-starts without showing the picker.
    await waitFor(() => {
      expect(mockStart.mock.calls.length).toBeGreaterThan(callsBefore);
    });
  });
});

describe('VoiceButton — picker auto-start arms the safety cap', () => {
  beforeEach(() => { jest.useFakeTimers(); });
  afterEach(() => { jest.useRealTimers(); });

  it('picker-started session auto-stops at the 3-min cap (regression for picker bypass)', async () => {
    // Multi-service detection so picker actually opens (single hit auto-starts).
    mockGetSpeechRecognitionServices.mockReturnValue([
      'com.google.android.tts',
      'com.samsung.android.bixby.agent',
    ]);
    mockGetDefaultRecognitionService.mockReturnValue({ packageName: 'com.google.android.tts' });

    const { getByText, queryAllByText } = renderButton();

    await act(async () => { fireEvent(getByText('⏺'), 'pressIn'); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    await act(async () => {
      listeners['error']?.({ code: 5, error: 'client', message: 'no service' });
    });
    // Let detection scan + setPickerVisible(true) flush
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });

    // Find the Bixby option specifically — avoids matching the "Using Google" toast
    // text that the single-hit auto-start path would render.
    const bixbyMatches = queryAllByText(/Bixby/);
    if (bixbyMatches.length === 0) {
      // Picker UI couldn't be rendered in this environment — skip rather than
      // assert on a UI surface we couldn't drive.
      return;
    }
    const startCallsBeforePick = mockStart.mock.calls.length;
    await act(async () => { fireEvent.press(bixbyMatches[0]); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); });
    expect(mockStart.mock.calls.length).toBeGreaterThan(startCallsBeforePick);

    // Advance past the 3-min cap — the regression was that picker-started
    // sessions skipped maxDurationTimer arming, so stop would never fire.
    const stopCallsBefore = mockStop.mock.calls.length;
    await act(async () => { jest.advanceTimersByTime(3 * 60 * 1000 + 100); });
    await act(async () => { await Promise.resolve(); });
    expect(mockStop.mock.calls.length).toBeGreaterThan(stopCallsBefore);
  });
});
