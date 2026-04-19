import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';

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
}));

// ── Retrieve mock references (runs after hoisted factories, before tests) ────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const speechMocked = jest.requireMock('expo-speech-recognition') as any;
const mockAddListener = speechMocked.ExpoSpeechRecognitionModule.addListener as jest.Mock;
const mockStart = speechMocked.ExpoSpeechRecognitionModule.start as jest.Mock;
const mockStop = speechMocked.ExpoSpeechRecognitionModule.stop as jest.Mock;
const mockRequestPermissionsAsync = speechMocked.ExpoSpeechRecognitionModule.requestPermissionsAsync as jest.Mock;

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

describe('VoiceButton — on-device engine (default)', () => {
  it('requests permission then starts recognition on first press', async () => {
    const { getByText } = renderButton();
    await act(async () => { fireEvent.press(getByText('⏺')); });
    await waitFor(() => expect(mockRequestPermissionsAsync).toHaveBeenCalledTimes(1));
    expect(mockStart).toHaveBeenCalledWith(expect.objectContaining({
      lang: 'en-US',
      interimResults: true,
    }));
    expect(getByText('⏹')).toBeTruthy();
  });

  it('stops recognition on second press', async () => {
    const { getByText } = renderButton();
    await act(async () => { fireEvent.press(getByText('⏺')); });
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await act(async () => { fireEvent.press(getByText('⏹')); });
    await waitFor(() => expect(mockStop).toHaveBeenCalled());
    expect(getByText('⏺')).toBeTruthy();
  });

  it('shows error when mic permission denied', async () => {
    mockRequestPermissionsAsync.mockResolvedValueOnce({ granted: false });
    const { getByText } = renderButton();
    await act(async () => { fireEvent.press(getByText('⏺')); });
    await waitFor(() => expect(getByText(/Microphone permission is required/)).toBeTruthy());
  });

  it('delivers transcript via onTranscript when result fires', async () => {
    const { getByText } = renderButton();
    await act(async () => { fireEvent.press(getByText('⏺')); });
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await act(async () => {
      listeners['result']?.({
        results: [{ transcript: 'hello world' }],
        isFinal: true,
      });
    });
    expect(onTranscript).toHaveBeenCalledWith('hello world', true);
  });

  it('delivers interim transcript', async () => {
    const { getByText } = renderButton();
    await act(async () => { fireEvent.press(getByText('⏺')); });
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await act(async () => {
      listeners['result']?.({
        results: [{ transcript: 'partial' }],
        isFinal: false,
      });
    });
    expect(onTranscript).toHaveBeenCalledWith('partial', false);
    // still listening after interim
    expect(getByText('⏹')).toBeTruthy();
  });

  it('resets to idle when error event fires', async () => {
    const { getByText } = renderButton();
    await act(async () => { fireEvent.press(getByText('⏺')); });
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await act(async () => { listeners['error']?.({ error: 'client error' }); });
    await waitFor(() => expect(getByText('⏺')).toBeTruthy());
    expect(getByText(/client error/)).toBeTruthy();
  });

  it('resets to idle when end event fires', async () => {
    const { getByText } = renderButton();
    await act(async () => { fireEvent.press(getByText('⏺')); });
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await act(async () => { listeners['end']?.({}); });
    await waitFor(() => expect(getByText('⏺')).toBeTruthy());
  });
});

describe('VoiceButton — Whisper engine', () => {
  beforeEach(() => {
    mockAsyncStorageGetItem.mockResolvedValue('whisper');
  });

  it('starts audio recording on first press', async () => {
    const { getByText } = renderButton();
    await act(async () => { fireEvent.press(getByText('⏺')); });
    await waitFor(() => expect(mockCreateAsync).toHaveBeenCalledTimes(1));
    expect(getByText('⏹')).toBeTruthy();
  });

  it('stops recording and delivers transcript on second press', async () => {
    (globalThis as { fetch: unknown }).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: 'whisper transcript' }),
    });

    const { getByText } = renderButton();
    await act(async () => { fireEvent.press(getByText('⏺')); });
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await act(async () => { fireEvent.press(getByText('⏹')); });
    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith('whisper transcript', true));
  });

  it('shows error when Whisper API key is missing', async () => {
    // Key-aware mock: engine = 'whisper', everything else null (no API key)
    mockAsyncStorageGetItem.mockImplementation((key: string) =>
      Promise.resolve(key === 'stt_engine' ? 'whisper' : null)
    );

    const { getByText } = renderButton();
    await act(async () => { fireEvent.press(getByText('⏺')); });
    await waitFor(() => expect(getByText('⏹')).toBeTruthy());
    await act(async () => { fireEvent.press(getByText('⏹')); });
    await waitFor(() => expect(getByText(/Whisper API key not set/)).toBeTruthy());
  });

  it('shows error when mic permission denied', async () => {
    mockAudioRequestPermissions.mockResolvedValueOnce({ granted: false });
    const { getByText } = renderButton();
    await act(async () => { fireEvent.press(getByText('⏺')); });
    await waitFor(() => expect(getByText(/Microphone permission is required/)).toBeTruthy());
  });
});
