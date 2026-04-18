import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import Voice, { SpeechErrorEvent, SpeechResultsEvent } from '@react-native-voice/voice';

interface VoiceButtonProps {
  onTranscript: (text: string, isFinal: boolean) => void;
  disabled?: boolean;
}

export function VoiceButton({ onTranscript, disabled }: VoiceButtonProps) {
  const [isListening, setIsListening] = useState(false);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const pulseLoop = useRef<Animated.CompositeAnimation | null>(null);

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

  const stopListening = useCallback(async () => {
    try {
      await Voice.stop();
    } catch {}
    setIsListening(false);
    stopPulse();
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  // pulseLoop and pulseAnim are refs (stable); setIsListening is a stable setter
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    Voice.onSpeechPartialResults = (e: SpeechResultsEvent) => {
      const partial = e.value?.[0];
      if (partial) onTranscript(partial, false);
    };
    Voice.onSpeechResults = (e: SpeechResultsEvent) => {
      const final = e.value?.[0];
      if (final) onTranscript(final, true);
      stopListening();
    };
    Voice.onSpeechError = (_e: SpeechErrorEvent) => {
      stopListening();
    };
    Voice.onSpeechEnd = () => {
      stopListening();
    };

    return () => {
      Voice.destroy().then(() => Voice.removeAllListeners());
    };
  }, [onTranscript, stopListening]);

  const startListening = async () => {
    try {
      await Voice.start('en-US');
      setIsListening(true);
      startPulse();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch {
      // permission denied or unavailable — fail silently
    }
  };

  const handlePress = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      style={({ pressed }: { pressed: boolean }) => [styles.btn, pressed && styles.btnPressed, disabled && styles.btnDisabled]}
      hitSlop={8}
    >
      <Animated.View style={[
        styles.ripple,
        isListening && styles.rippleActive,
        { transform: [{ scale: pulseAnim }] },
      ]} />
      <Text style={[styles.icon, isListening && styles.iconActive]}>
        {isListening ? '⏹' : '🎤'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#0d0d0d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPressed: { backgroundColor: '#1a1a1a' },
  btnDisabled: { opacity: 0.35 },
  ripple: {
    position: 'absolute',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'transparent',
  },
  rippleActive: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
  },
  icon: { fontSize: 26 },
  iconActive: {},
});
