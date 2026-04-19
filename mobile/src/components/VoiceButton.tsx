import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import {
  ExpoSpeechRecognitionModule,
  type ExpoSpeechRecognitionErrorEvent,
  type ExpoSpeechRecognitionResultEvent,
} from 'expo-speech-recognition';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';

export const STT_ENGINE_KEY = 'stt_engine';
export const WHISPER_API_KEY_STORAGE = 'whisper_api_key';
export const WHISPER_ENDPOINT_KEY = 'whisper_endpoint';
export const DEFAULT_WHISPER_ENDPOINT = 'https://api.openai.com/v1/audio/transcriptions';

interface VoiceButtonProps {
  onTranscript: (text: string, isFinal: boolean) => void;
  disabled?: boolean;
}

export function VoiceButton({ onTranscript, disabled }: VoiceButtonProps) {
  const [isListening, setIsListening] = useState(false);
  const [errMsg, setErrMsg] = useState('');
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);
  const started = useRef(false);
  const whisperRecording = useRef<Audio.Recording | null>(null);
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => { onTranscriptRef.current = onTranscript; });

  const startPulse = () => {
    pulseAnim.setValue(1);
    pulseLoop.current = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.3, duration: 600, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    );
    pulseLoop.current.start();
  };

  const stopPulse = () => {
    pulseLoop.current?.stop();
    pulseAnim.setValue(1);
  };

  const stopListening = useCallback(() => {
    if (!started.current) return;
    started.current = false;
    try { ExpoSpeechRecognitionModule.stop(); } catch {}
    setIsListening(false);
    stopPulse();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  // stable refs and setters only
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopListeningRef = useRef(stopListening);
  useEffect(() => { stopListeningRef.current = stopListening; });

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
      (event: ExpoSpeechRecognitionErrorEvent) => {
        const msg = `${event.error}${(event as any).message ? ': ' + (event as any).message : ''}`;
        setErrMsg(msg.slice(0, 60));
        setTimeout(() => setErrMsg(''), 8000);
        stopListeningRef.current();
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

  // ── On-device (Android SpeechRecognizer) ────────────────────────────────────

  const handlePressOnDevice = async () => {
    if (isListening) {
      stopListening();
      return;
    }
    setErrMsg('');
    const { granted } = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!granted) {
      setErrMsg('mic denied');
      setTimeout(() => setErrMsg(''), 4000);
      return;
    }
    try {
      ExpoSpeechRecognitionModule.start({
        lang: 'en-US',
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
      });
      started.current = true;
      setIsListening(true);
      startPulse();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      console.log('[Voice] on-device recognition started');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('[Voice] start error:', msg);
      setErrMsg(msg.slice(0, 40));
      setTimeout(() => setErrMsg(''), 4000);
    }
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
        if (!uri) { setErrMsg('no audio'); setTimeout(() => setErrMsg(''), 3000); return; }

        const [apiKey, endpoint] = await Promise.all([
          AsyncStorage.getItem(WHISPER_API_KEY_STORAGE),
          AsyncStorage.getItem(WHISPER_ENDPOINT_KEY),
        ]);
        const key = apiKey?.trim() ?? '';
        const ep = endpoint?.trim() || DEFAULT_WHISPER_ENDPOINT;

        if (!key) {
          setErrMsg('set Whisper key in Settings');
          setTimeout(() => setErrMsg(''), 4000);
          return;
        }

        setErrMsg('transcribing…');
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
          setErrMsg(txt.slice(0, 40));
          setTimeout(() => setErrMsg(''), 4000);
          return;
        }

        const data = await resp.json() as { text?: string };
        const text = data.text?.trim();
        if (text) onTranscriptRef.current(text, true);
      } catch (e: unknown) {
        setErrMsg('');
        const msg = e instanceof Error ? e.message : String(e);
        setErrMsg(msg.slice(0, 40));
        setTimeout(() => setErrMsg(''), 4000);
      }
      return;
    }

    // Start recording
    setErrMsg('');
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        setErrMsg('mic denied');
        setTimeout(() => setErrMsg(''), 4000);
        return;
      }
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
      const { recording } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY,
      );
      whisperRecording.current = recording;
      started.current = true;
      setIsListening(true);
      startPulse();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      console.log('[Voice] whisper recording started');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('[Voice] whisper start error:', msg);
      setErrMsg(msg.slice(0, 40));
      setTimeout(() => setErrMsg(''), 4000);
    }
  };

  // ── Router ───────────────────────────────────────────────────────────────────

  const handlePress = async () => {
    const engine = await AsyncStorage.getItem(STT_ENGINE_KEY);
    if (engine === 'whisper') {
      await handlePressWhisper();
    } else {
      await handlePressOnDevice();
    }
  };

  return (
    <View>
      <Pressable
        onPress={handlePress}
        disabled={disabled}
        style={({ pressed }: { pressed: boolean }) => [
          styles.btn,
          pressed && styles.btnPressed,
          isListening && styles.btnActive,
          disabled && styles.btnDisabled,
        ]}
        hitSlop={8}
      >
        <Animated.View style={[
          styles.ripple,
          isListening && styles.rippleActive,
          { transform: [{ scale: pulseAnim }] },
        ]} />
        <Text style={[styles.icon, isListening && styles.iconActive]}>
          {isListening ? '⏹' : '⏺'}
        </Text>
      </Pressable>
      {errMsg.length > 0 && <Text style={styles.err}>{errMsg}</Text>}
    </View>
  );
}

// Claude coral: #DA7756  Claude tan: #C4A882
const styles = StyleSheet.create({
  btn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1.5,
    borderColor: '#C4A882',
    backgroundColor: '#0d0d0d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: { backgroundColor: '#1a1008' },
  btnActive: { borderColor: '#DA7756' },
  btnDisabled: { opacity: 0.35 },
  ripple: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'transparent',
  },
  rippleActive: { backgroundColor: 'rgba(218, 119, 86, 0.15)' },
  icon: { fontSize: 26, color: '#C4A882' },
  iconActive: { color: '#DA7756' },
  err: { color: '#DA7756', fontSize: 10, textAlign: 'center', marginTop: 2 },
});
