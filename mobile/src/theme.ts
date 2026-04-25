// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import { MD3DarkTheme, MD3LightTheme, configureFonts } from 'react-native-paper';
import { Platform } from 'react-native';
import type { MD3Theme } from 'react-native-paper';

const monoFamily = Platform.OS === 'android' ? 'monospace' : 'Menlo';

const fontConfig = configureFonts({ config: { fontFamily: Platform.select({ ios: 'System', default: 'sans-serif' }) } });

const sharedColors = {
  primary: '#5B6ABF',
  onPrimary: '#FFFFFF',
  primaryContainer: '#DEE0FF',
  onPrimaryContainer: '#141937',
  secondary: '#5B5D72',
  onSecondary: '#FFFFFF',
  secondaryContainer: '#DFE1F9',
  onSecondaryContainer: '#181A2C',
  tertiary: '#77536D',
  onTertiary: '#FFFFFF',
  tertiaryContainer: '#FFD7F1',
  onTertiaryContainer: '#2D1228',
  error: '#BA1A1A',
  onError: '#FFFFFF',
  errorContainer: '#FFDAD6',
  onErrorContainer: '#410002',
};

export const lightTheme: MD3Theme = {
  ...MD3LightTheme,
  fonts: fontConfig,
  colors: {
    ...MD3LightTheme.colors,
    ...sharedColors,
    background: '#FBF8FF',
    onBackground: '#1B1B21',
    surface: '#FBF8FF',
    onSurface: '#1B1B21',
    surfaceVariant: '#E3E1EC',
    onSurfaceVariant: '#46464F',
    outline: '#777680',
    outlineVariant: '#C7C5D0',
    inverseSurface: '#303036',
    inverseOnSurface: '#F2F0F9',
    inversePrimary: '#BAC3FF',
    elevation: {
      level0: 'transparent',
      level1: '#F4F0FA',
      level2: '#EFEAF6',
      level3: '#EAE5F2',
      level4: '#E8E3F0',
      level5: '#E4E0EE',
    },
  },
};

export const darkTheme: MD3Theme = {
  ...MD3DarkTheme,
  fonts: fontConfig,
  colors: {
    ...MD3DarkTheme.colors,
    primary: '#BAC3FF',
    onPrimary: '#252D6B',
    primaryContainer: '#3D4583',
    onPrimaryContainer: '#DEE0FF',
    secondary: '#C3C5DD',
    onSecondary: '#2D2F42',
    secondaryContainer: '#434559',
    onSecondaryContainer: '#DFE1F9',
    tertiary: '#E6BAD7',
    onTertiary: '#44263D',
    tertiaryContainer: '#5D3C55',
    onTertiaryContainer: '#FFD7F1',
    error: '#FFB4AB',
    onError: '#690005',
    errorContainer: '#93000A',
    onErrorContainer: '#FFDAD6',
    background: '#121318',
    onBackground: '#E4E1E9',
    surface: '#121318',
    onSurface: '#E4E1E9',
    surfaceVariant: '#46464F',
    onSurfaceVariant: '#C7C5D0',
    outline: '#91909A',
    outlineVariant: '#46464F',
    inverseSurface: '#E4E1E9',
    inverseOnSurface: '#303036',
    inversePrimary: '#5B6ABF',
    elevation: {
      level0: 'transparent',
      level1: '#1B1B23',
      level2: '#21212B',
      level3: '#272733',
      level4: '#292935',
      level5: '#2D2D3B',
    },
  },
};

export type ThemeMode = 'system' | 'light' | 'dark';

export function getTheme(mode: ThemeMode, systemIsDark: boolean): MD3Theme {
  if (mode === 'light') return lightTheme;
  if (mode === 'dark') return darkTheme;
  return systemIsDark ? darkTheme : lightTheme;
}

export interface StatusColors {
  connected: string;
  connecting: string;
  error: string;
  disconnected: string;
}

// Takes theme directly so connected/error stay in sync with the MD3 palette; sibling helpers hardcode values because MD3 has no success/warning/info tokens.
export function getStatusColors(theme: MD3Theme, isDark: boolean): StatusColors {
  return {
    connected: theme.colors.primary,
    connecting: isDark ? '#FBBF24' : '#D97706',
    error: theme.colors.error,
    disconnected: theme.colors.outline,
  };
}

export interface SemanticColors {
  success: string;
  successContainer: string;
  onSuccessContainer: string;
  warning: string;
  warningContainer: string;
  onWarningContainer: string;
  info: string;
  infoContainer: string;
  onInfoContainer: string;
}

export function getSemanticColors(isDark: boolean): SemanticColors {
  return isDark ? {
    success: '#4ade80',
    successContainer: '#0a1a0a',
    onSuccessContainer: '#D1FAE5',
    warning: '#FBBF24',
    warningContainer: '#1c110a',
    onWarningContainer: '#FCD34D',
    info: '#93c5fd',
    infoContainer: '#0a1420',
    onInfoContainer: '#BFDBFE',
  } : {
    success: '#16a34a',
    successContainer: '#F0FDF4',
    onSuccessContainer: '#166534',
    warning: '#D97706',
    warningContainer: '#FFFBEB',
    onWarningContainer: '#78350f',
    info: '#3b82f6',
    infoContainer: '#EFF6FF',
    onInfoContainer: '#1e40af',
  };
}

export interface EventTypeColors {
  toolCall: string;
  assistant: string;
  result: string;
  system: string;
  done: string;
}

export function getEventTypeColors(isDark: boolean): EventTypeColors {
  return isDark ? {
    toolCall: '#93c5fd',
    assistant: '#a3e635',
    result: '#fb923c',
    system: '#9ca3af',
    done: '#4ade80',
  } : {
    toolCall: '#3b82f6',
    assistant: '#65a30d',
    result: '#ea580c',
    system: '#6b7280',
    done: '#16a34a',
  };
}

export { monoFamily };
