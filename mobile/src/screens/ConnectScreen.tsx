// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, IconButton, useTheme } from 'react-native-paper';
import { ConnectionStatus, ServerConfig } from '../types';

interface ConnectScreenProps {
  status: ConnectionStatus;
  onConnect: (config: ServerConfig) => void;
}

interface SavedConfig extends ServerConfig {
  id: string;
  name: string;
}

const CONFIGS_KEY = 'navette_saved_configs';
const LEGACY_KEY = 'navette_config';
const TS_API_KEY_STORAGE = 'tailscale_api_key';
const TOKEN_KEY_PREFIX = 'navette_token_';

function tokenKey(id: string): string {
  return `${TOKEN_KEY_PREFIX}${id}`;
}

interface TsPeer { name: string; ip: string; }

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export function ConnectScreen({ status, onConnect }: ConnectScreenProps) {
  const theme = useTheme();
  const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('7878');
  const [token, setToken] = useState('');
  const [container, setContainer] = useState('');
  const [tls, setTls] = useState(false);
  const [tsApiKey, setTsApiKey] = useState('');
  const [tsPeers, setTsPeers] = useState<TsPeer[]>([]);
  const [tsPeerVisible, setTsPeerVisible] = useState(false);
  const [tsLoading, setTsLoading] = useState(false);
  const [tsError, setTsError] = useState('');
  const [qrVisible, setQrVisible] = useState(false);
  const [qrError, setQrError] = useState('');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scannedRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem(TS_API_KEY_STORAGE).then((k: string | null) => { if (k) setTsApiKey(k); });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(CONFIGS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (!Array.isArray(parsed) || parsed.length === 0 || !parsed[0]?.host) throw new Error('invalid shape');
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

          setSavedConfigs(hydrated);
          if (hydrated.length > 0) fillForm(hydrated[0], true);
          return;
        }
        // Migrate legacy single config
        const legacy = await AsyncStorage.getItem(LEGACY_KEY);
        if (legacy) {
          const parsed = JSON.parse(legacy);
          if (!parsed || typeof parsed.host !== 'string') throw new Error('invalid shape');
          const cfg = parsed as ServerConfig;
          const id = genId();
          const migrated: SavedConfig = { ...cfg, id, name: cfg.host };
          if (cfg.token) {
            await SecureStore.setItemAsync(tokenKey(id), cfg.token);
          }
          const stripped: SavedConfig = { ...migrated, token: '' };
          await AsyncStorage.setItem(CONFIGS_KEY, JSON.stringify([stripped]));
          setSavedConfigs([migrated]);
          fillForm(migrated, true);
        }
      } catch (e: unknown) {
        if (__DEV__ && e instanceof Error) {
          console.warn('Config load failed:', e.message);
        }
      }
    })();
  }, []);

  function fillForm(cfg: SavedConfig, setId: boolean) {
    setName(cfg.name);
    setHost(cfg.host);
    setPort(cfg.port);
    setToken(cfg.token);
    setContainer(cfg.container ?? '');
    setTls(cfg.tls ?? false);
    if (setId) setSelectedId(cfg.id);
  }

  const handleSelect = (cfg: SavedConfig) => {
    fillForm(cfg, true);
  };

  const handleDelete = async (id: string) => {
    const updated = savedConfigs.filter(c => c.id !== id);
    setSavedConfigs(updated);
    const stripped = updated.map(c => ({ ...c, token: '' }));
    await AsyncStorage.setItem(CONFIGS_KEY, JSON.stringify(stripped));
    await SecureStore.deleteItemAsync(tokenKey(id));
    if (selectedId === id) {
      setSelectedId(null);
      if (updated.length > 0) fillForm(updated[0], true);
    }
  };

  const handleSave = async () => {
    const label = name.trim() || host.trim();
    if (!label || !host.trim()) return;

    const cfg: SavedConfig = {
      id: selectedId ?? genId(),
      name: label,
      host: host.trim(),
      port: port.trim(),
      token: token.trim(),
      container: container.trim() || undefined,
      tls,
    };

    if (cfg.token) {
      await SecureStore.setItemAsync(tokenKey(cfg.id), cfg.token);
    } else {
      await SecureStore.deleteItemAsync(tokenKey(cfg.id));
    }

    const existing = savedConfigs.findIndex(c => c.id === cfg.id);
    const updated = existing >= 0
      ? savedConfigs.map(c => c.id === cfg.id ? cfg : c)
      : [...savedConfigs, cfg];

    setSavedConfigs(updated);
    setSelectedId(cfg.id);
    setName(cfg.name);
    const stripped = updated.map(c => ({ ...c, token: '' }));
    await AsyncStorage.setItem(CONFIGS_KEY, JSON.stringify(stripped));
  };

  const openTailscale = async () => {
    try {
      await Linking.openURL('intent:#Intent;package=com.tailscale.ipn;end');
    } catch {
      Linking.openURL('https://play.google.com/store/apps/details?id=com.tailscale.ipn');
    }
  };

  const openQrScanner = async () => {
    setQrError('');
    scannedRef.current = false;
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission();
      if (!result.granted) {
        setQrError('Camera permission is required to scan QR codes.');
        return;
      }
    }
    setQrVisible(true);
  };

  const handleBarcodeScan = async ({ data }: { data: string }) => {
    if (scannedRef.current) return;
    scannedRef.current = true;

    try {
      if (!data.startsWith('navette://')) {
        setQrError('Not a navette QR code.');
        setQrVisible(false);
        return;
      }
      const encoded = data.slice('navette://'.length);
      const decoded = atob(encoded);
      const payload = JSON.parse(decoded) as { host?: string; port?: string; token?: string; tls?: boolean };
      if (!payload.host || !payload.port || !payload.token) {
        setQrError('QR code is missing connection details.');
        setQrVisible(false);
        return;
      }
      const scannedHost = payload.host;
      const scannedPort = payload.port;
      const scannedToken = payload.token;
      const scannedTls = payload.tls ?? false;
      const scannedName = `QR: ${scannedHost}`;

      setHost(scannedHost);
      setPort(scannedPort);
      setToken(scannedToken);
      setTls(scannedTls);
      setName(scannedName);
      setQrVisible(false);
      setQrError('');

      const id = genId();
      const cfg: SavedConfig = {
        id,
        name: scannedName,
        host: scannedHost,
        port: scannedPort,
        token: scannedToken,
        tls: scannedTls,
      };
      await SecureStore.setItemAsync(tokenKey(id), scannedToken);
      const updated = [...savedConfigs, cfg];
      setSavedConfigs(updated);
      setSelectedId(id);
      const stripped = updated.map(c => ({ ...c, token: '' }));
      await AsyncStorage.setItem(CONFIGS_KEY, JSON.stringify(stripped));
    } catch {
      setQrError('Could not decode QR code.');
      setQrVisible(false);
    }
  };

  const browsePeers = async () => {
    setTsLoading(true);
    setTsError('');
    try {
      const resp = await fetch('https://api.tailscale.com/api/v2/tailnet/-/devices', {
        headers: { Authorization: `Bearer ${tsApiKey}` },
      });
      if (!resp.ok) throw new Error(`${resp.status}`);
      const data = await resp.json();
      const peers: TsPeer[] = (data.devices ?? [])
        .map((d: { name?: string; hostname?: string; addresses?: string[] }) => ({
          name: (d.name ?? d.hostname ?? 'device').split('.')[0],
          ip: (d.addresses ?? []).find((a: string) => a.startsWith('100.')) ?? '',
        }))
        .filter((p: TsPeer) => p.ip);
      setTsPeers(peers);
      setTsPeerVisible(true);
    } catch (e: unknown) {
      setTsError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setTsLoading(false);
    }
  };

  const handleConnect = () => {
    onConnect({
      host: host.trim(),
      port: port.trim(),
      token: token.trim(),
      container: container.trim() || undefined,
      tls,
    });
  };

  const isLoading = status === 'connecting' || status === 'authenticating';
  const canConnect = host.length > 0 && port.length > 0 && token.length > 0 && !isLoading;
  const isDirty = selectedId !== null && (() => {
    const sel = savedConfigs.find(c => c.id === selectedId);
    if (!sel) return false;
    return sel.name !== (name || host) || sel.host !== host || sel.port !== port ||
      sel.token !== token || (sel.container ?? '') !== container;
  })();

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: theme.colors.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>navette</Text>
          <Text style={[styles.subtitle, { color: theme.colors.onSurfaceVariant }]}>remote tool approval</Text>

          <Button mode="contained-tonal" icon="qrcode-scan" onPress={openQrScanner} style={styles.qrBtn}>
            Scan QR to Connect
          </Button>
          {qrError.length > 0 && (
            <Text style={[styles.qrError, { color: theme.colors.error }]}>{qrError}</Text>
          )}

          {status === 'error' && (
            <View style={[styles.errorBanner, { backgroundColor: theme.colors.errorContainer, borderColor: theme.colors.error }]}>
              <Text style={{ color: theme.colors.onErrorContainer, fontSize: 13 }}>Connection failed — check host, port, and token</Text>
            </View>
          )}

          {savedConfigs.length > 0 && (
            <View style={styles.savedSection}>
              <Text style={[styles.savedLabel, { color: theme.colors.onSurfaceVariant }]}>Saved</Text>
              {savedConfigs.map(cfg => (
                <Pressable
                  key={cfg.id}
                  style={[styles.savedRow, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }, selectedId === cfg.id && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryContainer }]}
                  onPress={() => handleSelect(cfg)}
                >
                  <View style={styles.savedRowInfo}>
                    <Text style={[styles.savedRowName, { color: theme.colors.onSurface }, selectedId === cfg.id && { color: theme.colors.primary }]}>
                      {cfg.name}
                    </Text>
                    <Text style={[styles.savedRowHost, { color: theme.colors.onSurfaceVariant }]}>{cfg.host}:{cfg.port}</Text>
                  </View>
                  <IconButton icon="close" size={18} onPress={() => handleDelete(cfg.id)} />
                </Pressable>
              ))}
            </View>
          )}

          <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Name <Text style={[styles.optional, { color: theme.colors.onSurfaceVariant }]}>(for saved list)</Text></Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Home WiFi or Tailscale"
            placeholderTextColor={theme.colors.onSurfaceVariant}
            autoCorrect={false}
          />

          <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Host</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
            value={host}
            onChangeText={setHost}
            placeholder="100.x.x.x or 192.168.x.x"
            placeholderTextColor={theme.colors.onSurfaceVariant}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.tsRow}>
            <Button mode="outlined" compact onPress={openTailscale} style={{ flex: 1 }}>
              Open Tailscale
            </Button>
            {tsApiKey.length > 0 && (
              <Button mode="outlined" compact onPress={browsePeers} loading={tsLoading} disabled={tsLoading}>
                Browse peers
              </Button>
            )}
          </View>
          {tsError.length > 0 && <Text style={{ color: theme.colors.error, fontSize: 12, marginTop: 4 }}>Tailscale error: {tsError}</Text>}

          <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Port</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
            value={port}
            onChangeText={setPort}
            placeholder="7878"
            placeholderTextColor={theme.colors.onSurfaceVariant}
            keyboardType="number-pad"
          />

          <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Token</Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
            value={token}
            onChangeText={setToken}
            placeholder="from ~/.config/navetted/config.toml (token field)"
            placeholderTextColor={theme.colors.onSurfaceVariant}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          <Text style={[styles.label, { color: theme.colors.onSurfaceVariant }]}>Container <Text style={[styles.optional, { color: theme.colors.onSurfaceVariant }]}>(optional)</Text></Text>
          <TextInput
            style={[styles.input, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
            value={container}
            onChangeText={setContainer}
            placeholder="e.g. devbox — leave blank for host"
            placeholderTextColor={theme.colors.onSurfaceVariant}
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.actions}>
            <Button mode="outlined" onPress={handleSave} disabled={!canConnect} style={{ flex: 1 }}>
              {isDirty ? 'Update' : 'Save'}
            </Button>
            <Button mode="contained" onPress={handleConnect} disabled={!canConnect} loading={isLoading} style={{ flex: 2 }}>
              Connect
            </Button>
          </View>
        </View>
      </ScrollView>

      <Modal visible={tsPeerVisible} transparent animationType="fade" onRequestClose={() => setTsPeerVisible(false)}>
        <Pressable style={styles.tsOverlay} onPress={() => setTsPeerVisible(false)}>
          <View style={[styles.tsPeerModal, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant }]}>
            <Text style={[styles.tsPeerTitle, { color: theme.colors.onSurfaceVariant, borderBottomColor: theme.colors.outlineVariant }]}>Tailscale Peers</Text>
            {tsPeers.length === 0
              ? <Text style={[styles.tsPeerEmpty, { color: theme.colors.onSurfaceVariant }]}>No devices found</Text>
              : tsPeers.map(p => (
                <Pressable
                  key={p.ip}
                  style={[styles.tsPeerRow, { borderBottomColor: theme.colors.outlineVariant }]}
                  onPress={() => { setHost(p.ip); setName((n: string) => n || p.name); setTsPeerVisible(false); }}
                >
                  <Text style={[styles.tsPeerName, { color: theme.colors.onSurface }]}>{p.name}</Text>
                  <Text style={[styles.tsPeerIp, { color: theme.colors.primary }]}>{p.ip}</Text>
                </Pressable>
              ))
            }
          </View>
        </Pressable>
      </Modal>

      <Modal visible={qrVisible} animationType="slide" onRequestClose={() => setQrVisible(false)}>
        <View style={styles.qrModal}>
          <CameraView
            style={styles.qrCamera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleBarcodeScan}
          />
          <View style={styles.qrOverlay}>
            <Text style={[styles.qrHint, { color: theme.colors.onSurface }]}>Point camera at the QR code from `navetted --pair`</Text>
            <Button mode="outlined" onPress={() => setQrVisible(false)} textColor={theme.colors.onSurface} style={{ borderColor: theme.colors.outlineVariant }}>
              Cancel
            </Button>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  card: {
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    maxWidth: 600,
    alignSelf: 'center',
    width: '100%',
  },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, marginBottom: 4 },
  subtitle: { fontSize: 14, marginBottom: 20 },
  errorBanner: {
    borderRadius: 8, padding: 12,
    marginBottom: 16, borderWidth: 1,
  },
  savedSection: { marginBottom: 16 },
  savedLabel: {
    fontSize: 11, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  savedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderRadius: 8, borderWidth: 1,
    paddingHorizontal: 12, paddingVertical: 4, marginBottom: 6,
  },
  savedRowInfo: { flex: 1 },
  savedRowName: { fontSize: 14, fontWeight: '500' },
  savedRowHost: { fontSize: 12, marginTop: 2 },
  label: {
    fontSize: 12, fontWeight: '600',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 16,
  },
  optional: { fontSize: 11, fontWeight: '400', textTransform: 'none', letterSpacing: 0 },
  input: {
    borderRadius: 8, borderWidth: 1,
    padding: 12, fontSize: 15,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 28 },
  tsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  tsOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  tsPeerModal: {
    borderRadius: 14, width: '100%',
    borderWidth: 1, overflow: 'hidden',
  },
  tsPeerTitle: {
    fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1,
  },
  tsPeerRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1,
  },
  tsPeerName: { fontSize: 15, fontWeight: '500' },
  tsPeerIp: { fontSize: 13, fontFamily: 'Menlo' },
  tsPeerEmpty: { fontSize: 14, padding: 16, textAlign: 'center' },
  qrBtn: { marginBottom: 12 },
  qrError: { fontSize: 12, marginBottom: 8 },
  qrModal: { flex: 1, backgroundColor: '#000' },
  qrCamera: { flex: 1 },
  qrOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingBottom: 48, paddingTop: 20, alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  qrHint: { fontSize: 14, marginBottom: 16, textAlign: 'center', paddingHorizontal: 24 },
});
