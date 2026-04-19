import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Linking, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

export const STT_ENGINE_KEY = 'stt_engine';
export const STT_RECOGNIZER_PKG_KEY = 'stt_recognizer_pkg';
export const STT_RECOGNIZER_LABEL_KEY = 'stt_recognizer_label';
export const WHISPER_API_KEY_STORAGE = 'whisper_api_key';
export const WHISPER_ENDPOINT_KEY = 'whisper_endpoint';
export const DEFAULT_WHISPER_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

interface RecognizerOption {
  pkg: string;
  label: string;
}

// pkg: '' means "let Android pick the default recognizer"
const SYSTEM_DEFAULT_RECOGNIZER: RecognizerOption = { pkg: '', label: 'System Default' };

const KNOWN_RECOGNIZERS: RecognizerOption[] = [
  // Android System Intelligence — the actual on-device Google STT service. Prefer first.
  { pkg: 'com.google.android.as', label: 'Google (On-Device)' },
  // "Speech Services by Google" — the Play Store package that exposes Google STT
  // on most non-Pixel Androids (installed by anyone using Google TTS).
  { pkg: 'com.google.android.tts', label: 'Speech Services by Google' },
  { pkg: 'com.google.android.googlequicksearchbox', label: 'Google' },
  { pkg: 'com.google.android.voicesearch', label: 'Google Voice Search' },
  { pkg: 'com.google.android.apps.googleassistant', label: 'Google Assistant' },
  { pkg: 'com.samsung.android.bixby.agent', label: 'Samsung Bixby' },
  { pkg: 'com.samsung.android.speech', label: 'Samsung Voice' },
  { pkg: 'com.htc.sense.hsp', label: 'HTC Voice' },
  { pkg: 'com.nuance.android.vsuite.vsuiteapp', label: 'Nuance' },
  { pkg: 'com.iflytek.speechsuite', label: 'iFlytek' },
];

// Error codes that indicate the *current* recognizer can't serve the request
// (language missing, service unavailable) but another recognizer might.
// 11 = ERROR_LANGUAGE_UNAVAILABLE, 12 = ERROR_LANGUAGE_NOT_SUPPORTED,
// 13 = ERROR_SERVER_UNAVAILABLE.
const FAILOVER_CODES = new Set([11, 12, 13]);

const PREFERRED_LANG = 'en-US';

// Returns the best locale the given recognizer can serve, preferring an
// already-installed match over a claimed-but-not-downloaded one. Falls back
// to the preferred tag when the probe throws (old Android or missing perm).
async function pickBestLocale(pkg: string | null, preferred = PREFERRED_LANG): Promise<string> {
  try {
    const opts = pkg ? { androidRecognitionServicePackage: pkg } : {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = (await ExpoSpeechRecognitionModule.getSupportedLocales(opts)) as any;
    const locales: string[] = Array.isArray(res?.locales) ? res.locales : [];
    const installed: string[] = Array.isArray(res?.installedLocales) ? res.installedLocales : [];
    const lower = preferred.toLowerCase();
    const exact = (list: string[]) => list.find((l) => l.toLowerCase() === lower);
    const anyEn = (list: string[]) => list.find((l) => l.toLowerCase().startsWith('en-'));
    return exact(installed) ?? exact(locales) ?? anyEn(installed) ?? anyEn(locales) ?? preferred;
  } catch {
    return preferred;
  }
}

function sttErrorMessage(code: number, raw: string): string {
  const map: Record<number, string> = {
    1: 'Network error — check your connection',
    2: 'Network timeout — try again',
    3: 'Audio recording error — try again',
    4: 'Server error — try again later',
    5: 'No speech service found on device',
    6: 'No speech detected — speak closer to mic',
    7: 'Speech service not installed',
    8: 'Speech service busy — wait and retry',
    9: 'Microphone permission denied — check Settings',
    11: 'Language not supported by this service',
    13: 'Speech service unavailable',
  };
  return map[code] ? `${map[code]} (${code})` : raw || `Speech error ${code}`;
}

function labelForPackage(pkg: string): string {
  const known = KNOWN_RECOGNIZERS.find((r) => r.pkg === pkg);
  if (known) return known.label;
  // Fallback label: derive from last path segment, title-cased
  const seg = pkg.split('.').pop() ?? pkg;
  return seg.charAt(0).toUpperCase() + seg.slice(1);
}

async function detectAvailableRecognizers(): Promise<RecognizerOption[]> {
  // Primary: ask Android directly which recognizer services are installed.
  // This bypasses Android 11+ <queries> visibility issues and Android 13+
  // ERROR_LANGUAGE_UNAVAILABLE false negatives that the per-package probe hits.
  try {
    const services = ExpoSpeechRecognitionModule.getSpeechRecognitionServices();
    if (services && services.length > 0) {
      let defaultPkg = '';
      try {
        defaultPkg = ExpoSpeechRecognitionModule.getDefaultRecognitionService()?.packageName ?? '';
      } catch {
        // non-fatal
      }
      const options: RecognizerOption[] = services.map((pkg) => ({
        pkg,
        label: labelForPackage(pkg),
      }));
      // Hoist default to the front so it's the first choice presented
      options.sort((a, b) => {
        if (a.pkg === defaultPkg) return -1;
        if (b.pkg === defaultPkg) return 1;
        return 0;
      });
      return [...options, SYSTEM_DEFAULT_RECOGNIZER];
    }
  } catch {
    // fall through to legacy probe
  }

  // Fallback: legacy per-package probe for when getSpeechRecognitionServices
  // is unavailable or returns empty.
  const confirmed: RecognizerOption[] = [];
  const tentative: RecognizerOption[] = [];
  for (const r of KNOWN_RECOGNIZERS) {
    try {
      const result = await ExpoSpeechRecognitionModule.getSupportedLocales({
        androidRecognitionServicePackage: r.pkg,
      });
      if (result?.locales && result.locales.length > 0) {
        confirmed.push(r);
      }
    } catch (e: unknown) {
      const code = (e as { code?: number; nativeErrorCode?: number })?.code
        ?? (e as { code?: number; nativeErrorCode?: number })?.nativeErrorCode;
      const msg = e instanceof Error ? e.message : String(e);
      if (code === 14 || msg.includes('14')) {
        tentative.push(r);
      }
    }
  }
  const found = confirmed.length > 0 ? confirmed : tentative;
  return [...found, SYSTEM_DEFAULT_RECOGNIZER];
}

interface VoiceButtonProps {
  onTranscript: (text: string, isFinal: boolean) => void;
  disabled?: boolean;
}

type ErrAction = 'none' | 'no-service' | 'permission' | 'lang-unavailable';

export function VoiceButton({ onTranscript, disabled }: VoiceButtonProps) {
  const [isListening, setIsListening] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const [errPersist, setErrPersist] = useState(false);
  const [errAction, setErrAction] = useState<ErrAction>('none');
  const errPersistRef = useRef(false);
  const [detecting, setDetecting] = useState(false);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerOptions, setPickerOptions] = useState<RecognizerOption[]>([]);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const ring1Anim = useRef(new Animated.Value(0)).current;
  const ring2Anim = useRef(new Animated.Value(0)).current;
  const ring1Loop = useRef<Animated.CompositeAnimation | null>(null);
  const ring2Loop = useRef<Animated.CompositeAnimation | null>(null);
  const ring2Timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(false);
  const whisperRecording = useRef<Audio.Recording | null>(null);
  const onTranscriptRef = useRef(onTranscript);

  // Ordered list of pkg candidates to try if the current recognizer fails
  // with a failover-eligible code. Shift-from-front; empty means no more
  // fallbacks and the error is final.
  const failoverChainRef = useRef<(string | null)[]>([]);
  // True once detection has seeded the chain this session, so a later failure
  // doesn't loop back into detection indefinitely.
  const detectionRanRef = useRef(false);

  // Note: com.google.android.tts is intentionally NOT blacklisted. expo-speech-recognition
  // docs explicitly list it as a valid getDefaultRecognitionService() return on some devices.
  const KNOWN_BAD_PKGS: string[] = [];

  // Self-heal: clear stuck whisper state or known-bad recognizer packages
  useEffect(() => {
    let mounted = true;
    Promise.all([
      AsyncStorage.getItem(STT_ENGINE_KEY),
      AsyncStorage.getItem(WHISPER_API_KEY_STORAGE),
      AsyncStorage.getItem(STT_RECOGNIZER_PKG_KEY),
    ]).then(([engine, key, pkg]) => {
      if (!mounted) return;
      if (engine === 'whisper' && !key?.trim()) {
        AsyncStorage.removeItem(STT_ENGINE_KEY);
        AsyncStorage.removeItem(STT_RECOGNIZER_PKG_KEY);
        AsyncStorage.removeItem(STT_RECOGNIZER_LABEL_KEY);
      }
      if (pkg && KNOWN_BAD_PKGS.includes(pkg)) {
        AsyncStorage.removeItem(STT_RECOGNIZER_PKG_KEY);
        AsyncStorage.removeItem(STT_RECOGNIZER_LABEL_KEY);
      }
    }).catch(() => { /* ignore teardown rejections */ });
    return () => { mounted = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Master unmount cleanup: stop all timers and animation loops so they
  // can't fire setState after the component (and Jest env) have torn down.
  useEffect(() => {
    return () => {
      if (errTimeout.current) { clearTimeout(errTimeout.current); errTimeout.current = null; }
      if (ring2Timeout.current) { clearTimeout(ring2Timeout.current); ring2Timeout.current = null; }
      pulseLoop.current?.stop(); pulseLoop.current = null;
      ring1Loop.current?.stop(); ring1Loop.current = null;
      ring2Loop.current?.stop(); ring2Loop.current = null;
      if (started.current) {
        try { ExpoSpeechRecognitionModule.stop(); } catch { /* ignore */ }
        started.current = false;
      }
    };
  }, []);

  useEffect(() => { onTranscriptRef.current = onTranscript; });

  const showErrRef = useRef((msg: string, ms = 8000, persist = false, action: ErrAction = 'none') => {
    // Guard: a persistent error must not be clobbered by a transient one.
    if (errPersistRef.current && !persist) return;
    errPersistRef.current = persist;
    setErrMsg(msg);
    setErrPersist(persist);
    setErrAction(action);
    if (errTimeout.current) clearTimeout(errTimeout.current);
    if (!persist) {
      errTimeout.current = setTimeout(() => {
        errTimeout.current = null;
        setErrMsg('');
      }, ms);
    }
  });

  const dismissErr = useCallback(() => {
    errPersistRef.current = false;
    setErrMsg('');
    setErrPersist(false);
    setErrAction('none');
  }, []);

  const openPlayStore = useCallback((pkg: string) => {
    const market = `market://details?id=${pkg}`;
    const web = `https://play.google.com/store/apps/details?id=${pkg}`;
    Linking.openURL(market).catch(() => Linking.openURL(web));
  }, []);

  const openAppSettings = useCallback(() => {
    Linking.openSettings().catch(() => {});
  }, []);

  const retryDetection = useCallback(async () => {
    await AsyncStorage.removeItem(STT_RECOGNIZER_PKG_KEY);
    await AsyncStorage.removeItem(STT_RECOGNIZER_LABEL_KEY);
    dismissErr();
    await triggerDetectionRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dismissErr]);

  const switchToWhisper = useCallback(async () => {
    await AsyncStorage.setItem(STT_ENGINE_KEY, 'whisper');
    dismissErr();
    showErrRef.current('Switched to Whisper. Add API key in Settings → Voice Input.', 4000);
  }, [dismissErr]);

  const startPulse = () => {
    pulseAnim.setValue(1);
    ring1Anim.setValue(0);
    ring2Anim.setValue(0);

    // Subtle breathing on the orb itself
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.08, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    pulseLoop.current.start();

    // Ring 1 — starts immediately
    ring1Loop.current = Animated.loop(
      Animated.timing(ring1Anim, { toValue: 1, duration: 1800, useNativeDriver: true })
    );
    ring1Loop.current.start();

    // Ring 2 — staggered 900ms behind ring 1
    ring2Timeout.current = setTimeout(() => {
      ring2Loop.current = Animated.loop(
        Animated.timing(ring2Anim, { toValue: 1, duration: 1800, useNativeDriver: true })
      );
      ring2Loop.current.start();
    }, 900);
  };

  const stopPulse = () => {
    if (ring2Timeout.current !== null) {
      clearTimeout(ring2Timeout.current);
      ring2Timeout.current = null;
    }
    pulseLoop.current?.stop();
    ring1Loop.current?.stop();
    ring2Loop.current?.stop();
    ring1Loop.current = null;
    ring2Loop.current = null;
    pulseAnim.setValue(1);
    ring1Anim.setValue(0);
    ring2Anim.setValue(0);
  };

  const stopListening = useCallback(() => {
    if (!started.current) return;
    started.current = false;
    try { ExpoSpeechRecognitionModule.stop(); } catch {}
    setIsListening(false);
    stopPulse();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopListeningRef = useRef(stopListening);
  useEffect(() => { stopListeningRef.current = stopListening; });

  // Fires the native recognizer. Shared by the initial tap, post-detection auto-start,
  // and picker auto-start — all three paths share the same start options.
  //
  // Pairing EXTRA_PREFER_OFFLINE or requiresOnDeviceRecognition with a cloud-only
  // recognizer package is an unsatisfiable request, so the framework rejects
  // start() without surfacing an error to the JS layer. Only gate on-device hints
  // when the selected service actually ships an on-device model
  // (com.google.android.as = Android System Intelligence).
  const startRecognizerRef = useRef(async (pkg: string | null) => {
    const isOnDevicePkg = pkg === 'com.google.android.as';
    const lang = await pickBestLocale(pkg);
    try {
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
        requiresOnDeviceRecognition: isOnDevicePkg,
        ...(isOnDevicePkg
          ? { androidIntentOptions: { EXTRA_PREFER_OFFLINE: true } }
          : {}),
        ...(pkg ? { androidRecognitionServicePackage: pkg } : {}),
      });
      started.current = true;
      setIsListening(true);
      startPulse();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showErrRef.current(`STT start failed: ${msg}`, 0, true);
    }
  });

  // Detection flow — called from error handler (inside effect), so use ref
  const triggerDetectionRef = useRef(async () => {
    setDetecting(true);
    showErrRef.current(`Scanning ${KNOWN_RECOGNIZERS.length} speech services…`, 20000);
    try {
      const available = await detectAvailableRecognizers();
      setDetecting(false);
      setErrMsg('');
      detectionRanRef.current = true;

      if (available.length === 0) {
        failoverChainRef.current = [];
        showErrRef.current(
          'No speech service found on this device.\nInstall one below, or switch to Whisper API.',
          0,
          true,
          'no-service',
        );
        return;
      }

      if (available.length === 1) {
        if (available[0].pkg) {
          await AsyncStorage.setItem(STT_RECOGNIZER_PKG_KEY, available[0].pkg);
        } else {
          await AsyncStorage.removeItem(STT_RECOGNIZER_PKG_KEY);
        }
        await AsyncStorage.setItem(STT_RECOGNIZER_LABEL_KEY, available[0].label);
        showErrRef.current(`Using ${available[0].label}`, 1500);
        failoverChainRef.current = [];
        await startRecognizerRef.current(available[0].pkg || null);
        return;
      }

      // Multi-service: seed the failover chain with every detected package
      // (minus the one we'll show the picker for) so that, once the user
      // picks, subsequent failures can transparently try the rest.
      failoverChainRef.current = available.map((o) => o.pkg || null);
      setPickerOptions(available);
      setPickerVisible(true);
    } catch (e: unknown) {
      setDetecting(false);
      const msg = e instanceof Error ? e.message : String(e);
      showErrRef.current(`Detection failed: ${msg}`, 0, true);
    }
  });

  useEffect(() => {
    const resultSub = ExpoSpeechRecognitionModule.addListener(
      'result',
      (event: ExpoSpeechRecognitionResultEvent) => {
        const transcript = event.results[0]?.transcript;
        if (transcript) onTranscriptRef.current(transcript, event.isFinal);
        if (event.isFinal) stopListeningRef.current();
      }
    );
    const errorSub = ExpoSpeechRecognitionModule.addListener(
      'error',
      async (event: ExpoSpeechRecognitionErrorEvent) => {
        stopListeningRef.current();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const code = (event as any).code ?? -1;

        // 1. Failover: try the next candidate in the chain before giving up
        //    or re-running detection. Applies to language/server-availability
        //    errors where a different recognizer package might succeed.
        if (FAILOVER_CODES.has(code) && failoverChainRef.current.length > 0) {
          const nextPkg = failoverChainRef.current.shift() ?? null;
          const label = nextPkg ? labelForPackage(nextPkg) : 'System Default';
          showErrRef.current(`Retrying with ${label}…`, 2000);
          await startRecognizerRef.current(nextPkg);
          return;
        }

        // 2. No-service errors — existing detect-or-clear flow
        //    code 5 = client error (no service), code 7 = no recognition service
        if (code === 5 || code === 7) {
          const [savedPkg, savedLabel] = await Promise.all([
            AsyncStorage.getItem(STT_RECOGNIZER_PKG_KEY),
            AsyncStorage.getItem(STT_RECOGNIZER_LABEL_KEY),
          ]);
          if (savedPkg === null && savedLabel === null) {
            await triggerDetectionRef.current();
            return;
          }
          if (savedPkg === null && savedLabel !== null) {
            showErrRef.current(
              'No working speech service found.\nInstall one below, or switch to Whisper API.',
              0, true, 'no-service',
            );
            return;
          }
          await AsyncStorage.removeItem(STT_RECOGNIZER_PKG_KEY);
          await AsyncStorage.removeItem(STT_RECOGNIZER_LABEL_KEY);
          await triggerDetectionRef.current();
          return;
        }

        // 3. Failover-eligible code but chain is empty. If detection hasn't
        //    run this session, a fresh scan may surface more candidates;
        //    also clear the saved pkg since it just failed.
        if (FAILOVER_CODES.has(code) && !detectionRanRef.current) {
          await AsyncStorage.removeItem(STT_RECOGNIZER_PKG_KEY);
          await AsyncStorage.removeItem(STT_RECOGNIZER_LABEL_KEY);
          await triggerDetectionRef.current();
          return;
        }

        // 4. Language-specific final error — chain exhausted, detection ran
        if (code === 11 || code === 12) {
          showErrRef.current(
            'English voice model not installed on any speech service.\nOpen Speech Services by Google to download it, or switch to Whisper API.',
            0, true, 'lang-unavailable',
          );
          return;
        }

        // 5. Generic friendly error for everything else
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rawMsg = `${event.error}${(event as any).message ? ': ' + (event as any).message : ''} (code ${code})`;
        const friendlyMsg = sttErrorMessage(code, rawMsg);
        // Only truly transient errors auto-dismiss (6=no speech, 8=busy)
        const persist = ![6, 8].includes(code);
        showErrRef.current(friendlyMsg, 8000, persist);
      }
    );
    const endSub = ExpoSpeechRecognitionModule.addListener('end', () => {
      stopListeningRef.current();
    });

    return () => {
      resultSub.remove();
      errorSub.remove();
      endSub.remove();
      if (started.current) ExpoSpeechRecognitionModule.stop();
      whisperRecording.current?.stopAndUnloadAsync().catch(() => {});
    };
  }, []);

  const handlePickRecognizer = async (option: RecognizerOption) => {
    setPickerVisible(false);
    if (option.pkg) {
      await AsyncStorage.setItem(STT_RECOGNIZER_PKG_KEY, option.pkg);
    } else {
      await AsyncStorage.removeItem(STT_RECOGNIZER_PKG_KEY);
    }
    await AsyncStorage.setItem(STT_RECOGNIZER_LABEL_KEY, option.label);
    // Remove the picked package from the failover chain so we don't retry it
    // immediately if it fails — next-best candidates remain queued.
    failoverChainRef.current = failoverChainRef.current.filter(
      (p) => p !== (option.pkg || null),
    );
    showErrRef.current(`Using ${option.label}`, 1500);
    await startRecognizerRef.current(option.pkg || null);
  };

  const handlePickWhisper = async () => {
    setPickerVisible(false);
    await AsyncStorage.setItem(STT_ENGINE_KEY, 'whisper');
    showErrRef.current('Switched to Whisper. Add API key in Settings.', 3000);
  };

  // ── On-device (Android SpeechRecognizer) ────────────────────────────────────

  const handlePressOnDevice = async () => {
    if (isListening) { stopListening(); return; }
    setErrMsg('');
    const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      showErrRef.current(
        'Microphone permission is required for voice input.\nIf the system dialog did not appear, enable it manually in App Settings.',
        0, true, 'permission',
      );
      return;
    }
    const pkg = await AsyncStorage.getItem(STT_RECOGNIZER_PKG_KEY);
    // Fresh session — reset the chain and the detection-ran flag so the
    // error handler can re-seed from a new scan if the first attempt fails.
    failoverChainRef.current = [];
    detectionRanRef.current = false;
    await startRecognizerRef.current(pkg);
  };

  // ── Whisper API ──────────────────────────────────────────────────────────────

  const handlePressWhisper = async () => {
    if (isListening) {
      const rec = whisperRecording.current;
      if (!rec) { setIsListening(false); stopPulse(); return; }
      whisperRecording.current = null;
      started.current = false;
      setIsListening(false);
      stopPulse();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      try {
        await rec.stopAndUnloadAsync();
        const uri = rec.getURI();
        if (!uri) { showErrRef.current('no audio'); return; }
        const [apiKey, endpoint] = await Promise.all([
          AsyncStorage.getItem(WHISPER_API_KEY_STORAGE),
          AsyncStorage.getItem(WHISPER_ENDPOINT_KEY),
        ]);
        const key = apiKey?.trim() ?? '';
        const ep = endpoint?.trim() || DEFAULT_WHISPER_ENDPOINT;
        if (!key) { showErrRef.current('Whisper API key not set.\nGo to Settings → Voice Input to add your key.', 0, true); return; }
        showErrRef.current('Transcribing…', 30000);
        const form = new FormData();
        form.append('file', { uri, name: 'audio.m4a', type: 'audio/m4a' } as unknown as Blob);
        form.append('model', 'whisper-1');
        const resp = await fetch(ep, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key}` },
          body: form,
        });
        setErrMsg('');
        if (!resp.ok) {
          const txt = await resp.text().catch(() => resp.statusText);
          const detail = txt.slice(0, 120);
          showErrRef.current(`Whisper error ${resp.status}: ${detail}`, 0, true);
          return;
        }
        const data = await resp.json() as { text?: string };
        const text = data.text?.trim();
        if (text) onTranscriptRef.current(text, true);
      } catch (e: unknown) {
        setErrMsg('');
        const msg = e instanceof Error ? e.message : String(e);
        showErrRef.current(msg.slice(0, 60));
      }
      return;
    }

    setErrMsg('');
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        showErrRef.current(
          'Microphone permission is required for voice input.\nIf the system dialog did not appear, enable it manually in App Settings.',
          0, true, 'permission',
        );
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      whisperRecording.current = recording;
      started.current = true;
      setIsListening(true);
      startPulse();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showErrRef.current(msg.slice(0, 60));
    }
  };

  // ── Router ───────────────────────────────────────────────────────────────────

  const handlePress = async () => {
    if (detecting) return;
    const engine = await AsyncStorage.getItem(STT_ENGINE_KEY);
    if (engine === 'whisper') {
      await handlePressWhisper();
    } else {
      await handlePressOnDevice();
    }
  };

  return (
    <View>
      {/* Recognizer picker sheet */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setPickerVisible(false)}
      >
        <Pressable style={styles.overlay} onPress={() => setPickerVisible(false)}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>Choose voice recognizer</Text>
            <Text style={styles.sheetSub}>Multiple speech services found on this device</Text>
            {pickerOptions.map(opt => (
              <Pressable key={opt.pkg} style={styles.sheetOption} onPress={() => handlePickRecognizer(opt)}>
                <Text style={styles.sheetOptionLabel}>{opt.label}</Text>
                <Text style={styles.sheetOptionPkg}>{opt.pkg}</Text>
              </Pressable>
            ))}
            <Pressable style={styles.sheetWhisper} onPress={handlePickWhisper}>
              <Text style={styles.sheetWhisperText}>Use Whisper API instead →</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {/* Error / status popup sheet */}
      <Modal
        visible={errMsg.length > 0}
        transparent
        animationType="slide"
        onRequestClose={dismissErr}
      >
        <Pressable
          style={styles.overlay}
          onPress={errPersist ? undefined : dismissErr}
        >
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.errSheetTitle}>
              {errPersist ? '⚠️ Voice Input' : 'ℹ️ Voice Input'}
            </Text>
            <Text style={styles.errSheetMsg}>{errMsg}</Text>
            {errAction === 'permission' && (
              <View style={styles.errActions}>
                <Pressable style={styles.errActionBtn} onPress={openAppSettings}>
                  <Text style={styles.errActionBtnText}>Open App Settings</Text>
                  <Text style={styles.errActionBtnSub}>Grant Microphone permission manually</Text>
                </Pressable>
                <Pressable style={styles.errActionBtn} onPress={dismissErr}>
                  <Text style={styles.errActionBtnText}>Try Again</Text>
                  <Text style={styles.errActionBtnSub}>After enabling permission, tap mic</Text>
                </Pressable>
              </View>
            )}
            {errAction === 'lang-unavailable' && (
              <View style={styles.errActions}>
                <Pressable
                  style={styles.errActionBtn}
                  onPress={() => openPlayStore('com.google.android.tts')}
                >
                  <Text style={styles.errActionBtnText}>Open Speech Services by Google</Text>
                  <Text style={styles.errActionBtnSub}>Download the English voice model</Text>
                </Pressable>
                <Pressable style={styles.errActionBtn} onPress={retryDetection}>
                  <Text style={styles.errActionBtnText}>Retry Detection</Text>
                  <Text style={styles.errActionBtnSub}>After downloading, rescan devices</Text>
                </Pressable>
                <Pressable style={styles.errActionBtn} onPress={switchToWhisper}>
                  <Text style={styles.errActionBtnText}>Use Whisper API</Text>
                  <Text style={styles.errActionBtnSub}>Cloud transcription — needs API key</Text>
                </Pressable>
              </View>
            )}
            {errAction === 'no-service' && (
              <View style={styles.errActions}>
                <Pressable
                  style={styles.errActionBtn}
                  onPress={() => openPlayStore('com.google.android.tts')}
                >
                  <Text style={styles.errActionBtnText}>Install Speech Services by Google</Text>
                  <Text style={styles.errActionBtnSub}>com.google.android.tts — provides on-device STT</Text>
                </Pressable>
                <Pressable
                  style={styles.errActionBtn}
                  onPress={() => openPlayStore('com.samsung.android.bixby.agent')}
                >
                  <Text style={styles.errActionBtnText}>Install Samsung Bixby</Text>
                  <Text style={styles.errActionBtnSub}>com.samsung.android.bixby.agent</Text>
                </Pressable>
                <Pressable style={styles.errActionBtn} onPress={switchToWhisper}>
                  <Text style={styles.errActionBtnText}>Use Whisper API</Text>
                  <Text style={styles.errActionBtnSub}>Cloud transcription — needs API key</Text>
                </Pressable>
                <Pressable style={styles.errActionBtn} onPress={retryDetection}>
                  <Text style={styles.errActionBtnText}>Retry Detection</Text>
                  <Text style={styles.errActionBtnSub}>Rescan device for speech services</Text>
                </Pressable>
              </View>
            )}
            <Pressable style={styles.errSheetBtn} onPress={dismissErr}>
              <Text style={styles.errSheetBtnText}>
                {errAction === 'none' ? 'Got it' : 'Dismiss'}
              </Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.orbContainer}>
        {isListening && (
          <>
            <Animated.View style={[styles.ring, {
              opacity: ring1Anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.7, 0.4, 0] }),
              transform: [{ scale: ring1Anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.5] }) }],
            }]} />
            <Animated.View style={[styles.ring, {
              opacity: ring2Anim.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0.7, 0.4, 0] }),
              transform: [{ scale: ring2Anim.interpolate({ inputRange: [0, 1], outputRange: [1, 2.5] }) }],
            }]} />
          </>
        )}
        <Animated.View style={{ transform: [{ scale: pulseAnim }] }}>
          <Pressable
            onPress={handlePress}
            disabled={disabled || detecting}
            style={({ pressed }: { pressed: boolean }) => [
              styles.btn,
              pressed && styles.btnPressed,
              isListening && styles.btnActive,
              (disabled || detecting) && styles.btnDisabled,
            ]}
            hitSlop={8}
          >
            <Text style={[styles.icon, isListening && styles.iconActive]}>
              {detecting ? '…' : isListening ? '⏹' : '⏺'}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 64, height: 64, borderRadius: 32,
    borderWidth: 1.5, borderColor: '#C4A882',
    backgroundColor: '#0d0d0d',
    alignItems: 'center', justifyContent: 'center',
  },
  btnPressed: { backgroundColor: '#1a1008' },
  btnActive: {
    backgroundColor: '#DA7756',
    borderColor: '#DA7756',
    elevation: 8,
    shadowColor: '#DA7756',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 12,
  },
  btnDisabled: { opacity: 0.35 },
  orbContainer: {
    width: 160,
    height: 160,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: '#DA7756',
  },
  icon: { fontSize: 26, color: '#C4A882' },
  iconActive: { color: '#fff' },
  errSheetTitle: { color: '#f0f0f0', fontSize: 17, fontWeight: '700', marginBottom: 4 },
  errSheetMsg: { color: '#ccc', fontSize: 15, lineHeight: 22 },
  errSheetBtn: {
    marginTop: 16, backgroundColor: '#DA7756', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center',
  },
  errSheetBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  errActions: { gap: 10, marginTop: 12 },
  errActionBtn: {
    backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  errActionBtnText: { color: '#f0f0f0', fontSize: 15, fontWeight: '600' },
  errActionBtnSub: { color: '#666', fontSize: 12, marginTop: 3 },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#111', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 24, paddingBottom: 40, gap: 12,
  },
  sheetTitle: { color: '#f0f0f0', fontSize: 17, fontWeight: '700' },
  sheetSub: { color: '#666', fontSize: 13, marginBottom: 4 },
  sheetOption: {
    backgroundColor: '#1a1a1a', borderRadius: 10, padding: 16,
    borderWidth: 1, borderColor: '#2a2a2a',
  },
  sheetOptionLabel: { color: '#f0f0f0', fontSize: 15, fontWeight: '600' },
  sheetOptionPkg: { color: '#444', fontSize: 11, fontFamily: 'Menlo', marginTop: 2 },
  sheetWhisper: {
    marginTop: 4, padding: 14, borderRadius: 10,
    borderWidth: 1, borderColor: '#C4A882', alignItems: 'center',
  },
  sheetWhisperText: { color: '#C4A882', fontSize: 14, fontWeight: '600' },
});
