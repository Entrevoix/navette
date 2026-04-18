import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

const PIN_KEY = 'clauded_pin';
const PIN_NONE = 'none';

interface LockScreenProps {
  onUnlock: () => void;
}

type Mode = 'checking' | 'biometric' | 'pin_entry' | 'pin_setup' | 'pin_setup_confirm';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export function LockScreen({ onUnlock }: LockScreenProps) {
  const [mode, setMode] = useState<Mode>('checking');
  const [pin, setPin] = useState('');
  const [setupPin, setSetupPin] = useState('');
  const [error, setError] = useState('');

  const showPinEntry = useCallback(async () => {
    const stored = await AsyncStorage.getItem(PIN_KEY);
    if (stored === PIN_NONE) {
      onUnlock();
    } else if (stored) {
      setMode('pin_entry');
    } else {
      setMode('pin_setup');
    }
  }, [onUnlock]);

  const tryBiometric = useCallback(async () => {
    setMode('biometric');
    const hasHardware = await LocalAuthentication.hasHardwareAsync();
    const isEnrolled = await LocalAuthentication.isEnrolledAsync();
    if (hasHardware && isEnrolled) {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock clauded',
        fallbackLabel: 'Use PIN',
        disableDeviceFallback: false,
      });
      if (result.success) {
        onUnlock();
        return;
      }
    }
    showPinEntry();
  }, [onUnlock, showPinEntry]);

  useEffect(() => {
    tryBiometric();
  }, [tryBiometric]);

  const handleKey = (key: string) => {
    if (key === '⌫') {
      setPin(p => p.slice(0, -1));
      setError('');
      return;
    }
    const next = (pin + key).slice(0, 4);
    setPin(next);
    setError('');

    if (next.length < 4) return;

    if (mode === 'pin_entry') {
      (async () => {
        const stored = await AsyncStorage.getItem(PIN_KEY);
        if (next === stored) {
          onUnlock();
        } else {
          setError('Incorrect PIN');
          setPin('');
        }
      })();
    } else if (mode === 'pin_setup') {
      setSetupPin(next);
      setPin('');
      setMode('pin_setup_confirm');
    } else if (mode === 'pin_setup_confirm') {
      if (next === setupPin) {
        (async () => {
          await AsyncStorage.setItem(PIN_KEY, next);
          onUnlock();
        })();
      } else {
        setError('PINs do not match — try again');
        setPin('');
        setSetupPin('');
        setMode('pin_setup');
      }
    }
  };

  const handleSkip = async () => {
    await AsyncStorage.setItem(PIN_KEY, PIN_NONE);
    onUnlock();
  };

  const subtitle =
    mode === 'pin_setup' ? 'Set a 4-digit PIN' :
    mode === 'pin_setup_confirm' ? 'Confirm your PIN' :
    'Enter PIN';

  return (
    <View style={styles.container}>
      <Text style={styles.appName}>clauded</Text>

      {mode === 'biometric' && (
        <Text style={styles.subtitle}>Verifying identity…</Text>
      )}

      {(mode === 'pin_entry' || mode === 'pin_setup' || mode === 'pin_setup_confirm') && (
        <>
          <Text style={styles.subtitle}>{subtitle}</Text>

          <View style={styles.dotsRow}>
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} style={[styles.dot, i < pin.length && styles.dotFilled]} />
            ))}
          </View>

          {error !== '' && <Text style={styles.errorText}>{error}</Text>}

          <View style={styles.keypad}>
            {KEYS.map((k, i) =>
              k === '' ? (
                <View key={i} style={styles.keyEmpty} />
              ) : (
                <Pressable
                  key={i}
                  style={({ pressed }: { pressed: boolean }) => [styles.key, pressed && styles.keyPressed]}
                  onPress={() => handleKey(k)}
                >
                  <Text style={styles.keyText}>{k}</Text>
                </Pressable>
              )
            )}
          </View>

          {mode === 'pin_entry' && (
            <Pressable onPress={tryBiometric} style={styles.altBtn}>
              <Text style={styles.altBtnText}>Use Biometrics</Text>
            </Pressable>
          )}

          {(mode === 'pin_setup' || mode === 'pin_setup_confirm') && (
            <Pressable onPress={handleSkip} style={styles.altBtn}>
              <Text style={styles.altBtnText}>Skip — no PIN protection</Text>
            </Pressable>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    color: '#f0f0f0',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 32,
  },
  dotsRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 8,
  },
  dot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: '#444',
    backgroundColor: 'transparent',
  },
  dotFilled: {
    backgroundColor: '#4ade80',
    borderColor: '#4ade80',
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
    marginTop: 8,
    marginBottom: 8,
  },
  keypad: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: 240,
    marginTop: 24,
    gap: 12,
  },
  key: {
    width: 68,
    height: 68,
    borderRadius: 34,
    backgroundColor: '#141414',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyPressed: {
    backgroundColor: '#1f1f1f',
  },
  keyEmpty: {
    width: 68,
    height: 68,
  },
  keyText: {
    color: '#f0f0f0',
    fontSize: 22,
    fontWeight: '400',
  },
  altBtn: {
    marginTop: 28,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  altBtnText: {
    color: '#4ade80',
    fontSize: 14,
    fontWeight: '500',
  },
});
