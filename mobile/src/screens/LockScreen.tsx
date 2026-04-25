// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Button, IconButton, useTheme } from 'react-native-paper';

const PIN_KEY = 'navette_pin';
const PIN_NONE = 'none';

interface LockScreenProps {
  onUnlock: () => void;
}

type Mode = 'checking' | 'biometric' | 'pin_entry' | 'pin_setup' | 'pin_setup_confirm';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

export function LockScreen({ onUnlock }: LockScreenProps) {
  const theme = useTheme();
  const [mode, setMode] = useState<Mode>('checking');
  const [pin, setPin] = useState('');
  const [setupPin, setSetupPin] = useState('');
  const [error, setError] = useState('');

  const showPinEntry = useCallback(async () => {
    const stored = await SecureStore.getItemAsync(PIN_KEY);
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
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (hasHardware && isEnrolled) {
        const result = await LocalAuthentication.authenticateAsync({
          promptMessage: 'Unlock navette',
          // Required on Android when disableDeviceFallback is true: the BiometricPrompt
          // builder throws if the negative button text is empty.
          cancelLabel: 'Use PIN',
          // Device passcode bypass disabled — app PIN is the fallback, not the device lock.
          disableDeviceFallback: true,
        });
        if (result.success) {
          onUnlock();
          return;
        }
      }
    } catch {
      // Fall through to PIN entry on any native failure.
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
        const stored = await SecureStore.getItemAsync(PIN_KEY);
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
          await SecureStore.setItemAsync(PIN_KEY, next);
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
    await SecureStore.setItemAsync(PIN_KEY, PIN_NONE);
    onUnlock();
  };

  const subtitle =
    mode === 'pin_setup' ? 'Set a 4-digit PIN' :
    mode === 'pin_setup_confirm' ? 'Confirm your PIN' :
    'Enter PIN';

  return (
    <View style={[styles.outer, { backgroundColor: theme.colors.background }]}>
    <View style={styles.container}>
      <Text style={[styles.appName, { color: theme.colors.onSurface }]}>navette</Text>

      {mode === 'biometric' && (
        <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>Verifying identity…</Text>
      )}

      {(mode === 'pin_entry' || mode === 'pin_setup' || mode === 'pin_setup_confirm') && (
        <>
          <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>{subtitle}</Text>

          <View style={styles.dotsRow}>
            {Array.from({ length: 4 }).map((_, i) => (
              <View key={i} style={[styles.dot, { borderColor: theme.colors.outlineVariant }, i < pin.length && { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary }]} />
            ))}
          </View>

          {error !== '' && <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>}

          <View style={styles.keypad}>
            {KEYS.map((k, i) =>
              k === '' ? (
                <View key={i} style={styles.keyEmpty} />
              ) : k === '⌫' ? (
                <IconButton key={i} icon="backspace-outline" size={24} onPress={() => handleKey(k)} style={[styles.key, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant }]} />
              ) : (
                <Pressable
                  key={i}
                  style={({ pressed }: { pressed: boolean }) => [styles.key, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant }, pressed && { backgroundColor: theme.colors.surfaceDisabled }]}
                  onPress={() => handleKey(k)}
                >
                  <Text style={[styles.keyText, { color: theme.colors.onSurface }]}>{k}</Text>
                </Pressable>
              )
            )}
          </View>

          {mode === 'pin_entry' && (
            <Button mode="text" onPress={tryBiometric} style={styles.altBtn}>Use Biometrics</Button>
          )}

          {(mode === 'pin_setup' || mode === 'pin_setup_confirm') && (
            <Button mode="text" onPress={handleSkip} style={styles.altBtn}>Skip — no PIN protection</Button>
          )}
        </>
      )}
    </View>
    </View>
  );
}

const styles = StyleSheet.create({
  outer: { flex: 1 },
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 40,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  appName: {
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
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
    backgroundColor: 'transparent',
  },
  errorText: {
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
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  keyEmpty: {
    width: 68,
    height: 68,
  },
  keyText: {
    fontSize: 22,
    fontWeight: '400',
  },
  altBtn: {
    marginTop: 28,
  },
});
