// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import AsyncStorage from '@react-native-async-storage/async-storage';
import { CameraView, useCameraPermissions } from 'expo-camera';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

interface TsPeer { name: string; ip: string; }

function genId() {
  return Math.random().toString(36).slice(2, 10);
}

export function ConnectScreen({ status, onConnect }: ConnectScreenProps) {
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
      const raw = await AsyncStorage.getItem(CONFIGS_KEY);
      if (raw) {
        const configs = JSON.parse(raw) as SavedConfig[];
        setSavedConfigs(configs);
        if (configs.length > 0) fillForm(configs[0], true);
        return;
      }
      // Migrate legacy single config
      const legacy = await AsyncStorage.getItem(LEGACY_KEY);
      if (legacy) {
        const cfg = JSON.parse(legacy) as ServerConfig;
        const migrated: SavedConfig = { ...cfg, id: genId(), name: cfg.host };
        const list = [migrated];
        await AsyncStorage.setItem(CONFIGS_KEY, JSON.stringify(list));
        setSavedConfigs(list);
        fillForm(migrated, true);
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
    await AsyncStorage.setItem(CONFIGS_KEY, JSON.stringify(updated));
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

    const existing = savedConfigs.findIndex(c => c.id === cfg.id);
    const updated = existing >= 0
      ? savedConfigs.map(c => c.id === cfg.id ? cfg : c)
      : [...savedConfigs, cfg];

    setSavedConfigs(updated);
    setSelectedId(cfg.id);
    setName(cfg.name);
    await AsyncStorage.setItem(CONFIGS_KEY, JSON.stringify(updated));
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

  const handleBarcodeScan = ({ data }: { data: string }) => {
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
      setHost(payload.host);
      setPort(payload.port);
      setToken(payload.token);
      setTls(payload.tls ?? false);
      setName(`QR: ${payload.host}`);
      setSelectedId(null);
      setQrVisible(false);
      setQrError('');
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
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.title}>navette</Text>
          <Text style={styles.subtitle}>remote tool approval</Text>

          <Pressable style={styles.qrBtn} onPress={openQrScanner}>
            <Text style={styles.qrBtnText}>Scan QR to Connect</Text>
          </Pressable>
          {qrError.length > 0 && (
            <Text style={styles.qrError}>{qrError}</Text>
          )}

          {status === 'error' && (
            <View style={styles.errorBanner}>
              <Text style={styles.errorText}>Connection failed — check host, port, and token</Text>
            </View>
          )}

          {savedConfigs.length > 0 && (
            <View style={styles.savedSection}>
              <Text style={styles.savedLabel}>Saved</Text>
              {savedConfigs.map(cfg => (
                <Pressable
                  key={cfg.id}
                  style={[styles.savedRow, selectedId === cfg.id && styles.savedRowSelected]}
                  onPress={() => handleSelect(cfg)}
                >
                  <View style={styles.savedRowInfo}>
                    <Text style={[styles.savedRowName, selectedId === cfg.id && styles.savedRowNameSelected]}>
                      {cfg.name}
                    </Text>
                    <Text style={styles.savedRowHost}>{cfg.host}:{cfg.port}</Text>
                  </View>
                  <Pressable
                    onPress={() => handleDelete(cfg.id)}
                    hitSlop={12}
                    style={styles.deleteBtn}
                  >
                    <Text style={styles.deleteText}>×</Text>
                  </Pressable>
                </Pressable>
              ))}
            </View>
          )}

          <Text style={styles.label}>Name <Text style={styles.optional}>(for saved list)</Text></Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="e.g. Home WiFi or Tailscale"
            placeholderTextColor="#555"
            autoCorrect={false}
          />

          <Text style={styles.label}>Host</Text>
          <TextInput
            style={styles.input}
            value={host}
            onChangeText={setHost}
            placeholder="100.x.x.x or 192.168.x.x"
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.tsRow}>
            <Pressable onPress={openTailscale} style={styles.tsBtn}>
              <Text style={styles.tsBtnText}>Open Tailscale ↗</Text>
            </Pressable>
            {tsApiKey.length > 0 && (
              <Pressable onPress={browsePeers} style={styles.tsBrowseBtn} disabled={tsLoading}>
                {tsLoading
                  ? <ActivityIndicator size="small" color="#5b8dd9" />
                  : <Text style={styles.tsBrowseBtnText}>Browse peers</Text>}
              </Pressable>
            )}
          </View>
          {tsError.length > 0 && <Text style={styles.tsError}>Tailscale error: {tsError}</Text>}

          <Text style={styles.label}>Port</Text>
          <TextInput
            style={styles.input}
            value={port}
            onChangeText={setPort}
            placeholder="7878"
            placeholderTextColor="#555"
            keyboardType="number-pad"
          />

          <Text style={styles.label}>Token</Text>
          <TextInput
            style={styles.input}
            value={token}
            onChangeText={setToken}
            placeholder="from ~/.config/navetted/config.toml (token field)"
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          <Text style={styles.label}>Container <Text style={styles.optional}>(optional)</Text></Text>
          <TextInput
            style={styles.input}
            value={container}
            onChangeText={setContainer}
            placeholder="e.g. devbox — leave blank for host"
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
          />

          <View style={styles.actions}>
            <Pressable
              style={[styles.saveBtn, !canConnect && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={!canConnect}
            >
              <Text style={styles.saveBtnText}>{isDirty ? 'Update' : 'Save'}</Text>
            </Pressable>
            <Pressable
              style={[styles.connectBtn, !canConnect && styles.connectBtnDisabled]}
              onPress={handleConnect}
              disabled={!canConnect}
            >
              {isLoading ? (
                <ActivityIndicator color="#000" />
              ) : (
                <Text style={styles.connectBtnText}>Connect</Text>
              )}
            </Pressable>
          </View>
        </View>
      </ScrollView>

      <Modal visible={tsPeerVisible} transparent animationType="fade" onRequestClose={() => setTsPeerVisible(false)}>
        <Pressable style={styles.tsOverlay} onPress={() => setTsPeerVisible(false)}>
          <View style={styles.tsPeerModal}>
            <Text style={styles.tsPeerTitle}>Tailscale Peers</Text>
            {tsPeers.length === 0
              ? <Text style={styles.tsPeerEmpty}>No devices found</Text>
              : tsPeers.map(p => (
                <Pressable
                  key={p.ip}
                  style={styles.tsPeerRow}
                  onPress={() => { setHost(p.ip); setName(n => n || p.name); setTsPeerVisible(false); }}
                >
                  <Text style={styles.tsPeerName}>{p.name}</Text>
                  <Text style={styles.tsPeerIp}>{p.ip}</Text>
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
            <Text style={styles.qrHint}>Point camera at the QR code from `navetted --pair`</Text>
            <Pressable style={styles.qrCloseBtn} onPress={() => setQrVisible(false)}>
              <Text style={styles.qrCloseBtnText}>Cancel</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  scroll: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  card: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  title: { fontSize: 28, fontWeight: '700', color: '#f0f0f0', letterSpacing: -0.5, marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 20 },
  errorBanner: {
    backgroundColor: '#2d1010', borderRadius: 8, padding: 12,
    marginBottom: 16, borderWidth: 1, borderColor: '#6b1f1f',
  },
  errorText: { color: '#f87171', fontSize: 13 },
  savedSection: { marginBottom: 16 },
  savedLabel: {
    fontSize: 11, fontWeight: '600', color: '#555',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  savedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#0d0d0d', borderRadius: 8, borderWidth: 1,
    borderColor: '#2a2a2a', paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6,
  },
  savedRowSelected: { borderColor: '#4ade80', backgroundColor: '#0d1a10' },
  savedRowInfo: { flex: 1 },
  savedRowName: { color: '#ccc', fontSize: 14, fontWeight: '500' },
  savedRowNameSelected: { color: '#4ade80' },
  savedRowHost: { color: '#555', fontSize: 12, marginTop: 2 },
  deleteBtn: { paddingLeft: 12 },
  deleteText: { color: '#555', fontSize: 20, lineHeight: 22 },
  label: {
    fontSize: 12, fontWeight: '600', color: '#888',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6, marginTop: 16,
  },
  optional: { fontSize: 11, fontWeight: '400', color: '#555', textTransform: 'none', letterSpacing: 0 },
  input: {
    backgroundColor: '#0a0a0a', borderRadius: 8, borderWidth: 1,
    borderColor: '#2a2a2a', padding: 12, color: '#f0f0f0', fontSize: 15,
  },
  actions: { flexDirection: 'row', gap: 10, marginTop: 28 },
  saveBtn: {
    flex: 1, backgroundColor: '#1a1a1a', borderRadius: 10, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a',
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#888', fontWeight: '600', fontSize: 15 },
  connectBtn: {
    flex: 2, backgroundColor: '#e2e8f0', borderRadius: 10, padding: 14, alignItems: 'center',
  },
  connectBtnDisabled: { opacity: 0.4 },
  connectBtnText: { color: '#0a0a0a', fontWeight: '700', fontSize: 16 },

  tsRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  tsBtn: {
    flex: 1, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 7,
    borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#0d0d0d',
    alignItems: 'center',
  },
  tsBtnText: { color: '#5b8dd9', fontSize: 13, fontWeight: '600' },
  tsBrowseBtn: {
    paddingVertical: 8, paddingHorizontal: 14, borderRadius: 7,
    borderWidth: 1, borderColor: '#1e3a5f', backgroundColor: '#0d1520',
    alignItems: 'center', justifyContent: 'center', minWidth: 100,
  },
  tsBrowseBtnText: { color: '#93c5fd', fontSize: 13, fontWeight: '600' },
  tsError: { color: '#f87171', fontSize: 12, marginTop: 4 },

  tsOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', alignItems: 'center', padding: 24,
  },
  tsPeerModal: {
    backgroundColor: '#141414', borderRadius: 14, width: '100%',
    borderWidth: 1, borderColor: '#2a2a2a', overflow: 'hidden',
  },
  tsPeerTitle: {
    color: '#888', fontSize: 11, fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: 0.8, paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  tsPeerRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  tsPeerName: { color: '#f0f0f0', fontSize: 15, fontWeight: '500' },
  tsPeerIp: { color: '#5b8dd9', fontSize: 13, fontFamily: 'Menlo' },
  tsPeerEmpty: { color: '#555', fontSize: 14, padding: 16, textAlign: 'center' },

  qrBtn: {
    backgroundColor: '#0d1520', borderRadius: 10, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: '#1e3a5f', marginBottom: 12,
  },
  qrBtnText: { color: '#93c5fd', fontWeight: '700', fontSize: 15 },
  qrError: { color: '#f87171', fontSize: 12, marginBottom: 8 },
  qrModal: { flex: 1, backgroundColor: '#000' },
  qrCamera: { flex: 1 },
  qrOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    paddingBottom: 48, paddingTop: 20, alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  qrHint: { color: '#ccc', fontSize: 14, marginBottom: 16, textAlign: 'center', paddingHorizontal: 24 },
  qrCloseBtn: {
    paddingHorizontal: 28, paddingVertical: 12, borderRadius: 10,
    backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a',
  },
  qrCloseBtnText: { color: '#f0f0f0', fontSize: 15, fontWeight: '600' },
});
