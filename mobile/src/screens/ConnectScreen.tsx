import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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

const CONFIGS_KEY = 'clauded_saved_configs';
const LEGACY_KEY = 'clauded_config';

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

  const handleConnect = () => {
    onConnect({
      host: host.trim(),
      port: port.trim(),
      token: token.trim(),
      container: container.trim() || undefined,
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
          <Text style={styles.title}>Relay</Text>
          <Text style={styles.subtitle}>remote tool approval</Text>

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
            placeholder="from ~/.config/clauded/config.toml (token field)"
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
});
