// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { ServerConfig, SavedConfig } from '../types';

export const CONFIGS_KEY = 'navette_saved_configs';
export const LEGACY_KEY = 'navette_config';
export const TOKEN_KEY_PREFIX = 'navette_token_';

export function tokenKey(id: string): string {
  return `${TOKEN_KEY_PREFIX}${id}`;
}

function genId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export async function loadSavedConfigs(): Promise<SavedConfig[]> {
  try {
    const raw = await AsyncStorage.getItem(CONFIGS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0 || !parsed[0]?.host) return [];
      const configs = parsed as SavedConfig[];

      const hydrated = await Promise.all(configs.map(async (cfg) => {
        const stored = await SecureStore.getItemAsync(tokenKey(cfg.id));
        if (stored) return { ...cfg, token: stored };
        if (cfg.token) {
          await SecureStore.setItemAsync(tokenKey(cfg.id), cfg.token);
        }
        return cfg;
      }));

      const needsStrip = hydrated.some((_cfg, i) => !!configs[i].token);
      if (needsStrip) {
        const stripped = hydrated.map(c => ({ ...c, token: '' }));
        await AsyncStorage.setItem(CONFIGS_KEY, JSON.stringify(stripped));
      }

      return hydrated;
    }

    const legacy = await AsyncStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (!parsed || typeof parsed.host !== 'string') return [];
      const cfg = parsed as ServerConfig;
      const id = genId();
      const migrated: SavedConfig = { ...cfg, id, name: cfg.host };
      if (cfg.token) {
        await SecureStore.setItemAsync(tokenKey(id), cfg.token);
      }
      const stripped: SavedConfig = { ...migrated, token: '' };
      await AsyncStorage.setItem(CONFIGS_KEY, JSON.stringify([stripped]));
      return [migrated];
    }
  } catch (e: unknown) {
    if (__DEV__ && e instanceof Error) {
      console.warn('Config load failed:', e.message);
    }
  }
  return [];
}

export function findConfigName(config: ServerConfig | null, savedConfigs: SavedConfig[]): string {
  if (!config) return '';
  const match = savedConfigs.find(
    c => c.host === config.host && c.port === config.port
  );
  return match?.name ?? config.host;
}
