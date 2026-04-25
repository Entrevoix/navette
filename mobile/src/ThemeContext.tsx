// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';
import type { MD3Theme } from 'react-native-paper';

import { getTheme, type ThemeMode } from './theme';

const STORAGE_KEY = 'navette_theme_mode';

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  theme: MD3Theme;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v: string | null) => {
        if (v === 'system' || v === 'light' || v === 'dark') setModeState(v);
        else setModeState('system');
      })
      .catch(() => setModeState('system'));
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  if (mode === null) return null;

  const systemIsDark = systemScheme !== 'light';
  const theme = getTheme(mode, systemIsDark);
  const isDark = mode === 'dark' || (mode === 'system' && systemIsDark);

  return (
    <ThemeContext.Provider value={{ mode, setMode, theme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeMode(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useThemeMode must be used within ThemeProvider');
  return ctx;
}
