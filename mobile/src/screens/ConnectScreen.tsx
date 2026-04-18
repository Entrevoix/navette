import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
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

const STORAGE_KEY = 'clauded_config';

export function ConnectScreen({ status, onConnect }: ConnectScreenProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('7878');
  const [token, setToken] = useState('');

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(raw => {
      if (!raw) return;
      try {
        const saved = JSON.parse(raw) as ServerConfig;
        setHost(saved.host);
        setPort(saved.port);
        setToken(saved.token);
      } catch {}
    });
  }, []);

  const handleConnect = async () => {
    const cfg: ServerConfig = { host: host.trim(), port: port.trim(), token: token.trim() };
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    onConnect(cfg);
  };

  const isLoading = status === 'connecting' || status === 'authenticating';
  const canConnect = host.length > 0 && port.length > 0 && token.length > 0 && !isLoading;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.card}>
        <Text style={styles.title}>clauded</Text>
        <Text style={styles.subtitle}>remote tool approval</Text>

        {status === 'error' && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>Connection failed — check host, port, and token</Text>
          </View>
        )}

        <Text style={styles.label}>Host (Tailscale IP or hostname)</Text>
        <TextInput
          style={styles.input}
          value={host}
          onChangeText={setHost}
          placeholder="100.x.x.x"
          placeholderTextColor="#555"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="default"
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
          placeholder="from ~/.config/clauded/config.toml"
          placeholderTextColor="#555"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
        />

        <Pressable
          style={[styles.button, !canConnect && styles.buttonDisabled]}
          onPress={handleConnect}
          disabled={!canConnect}
        >
          {isLoading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.buttonText}>Connect</Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#141414',
    borderRadius: 16,
    padding: 24,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#f0f0f0',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 28,
  },
  errorBanner: {
    backgroundColor: '#2d1010',
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#6b1f1f',
  },
  errorText: {
    color: '#f87171',
    fontSize: 13,
  },
  label: {
    fontSize: 12,
    fontWeight: '600',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginTop: 16,
  },
  input: {
    backgroundColor: '#0a0a0a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 12,
    color: '#f0f0f0',
    fontSize: 15,
  },
  button: {
    backgroundColor: '#e2e8f0',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 28,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: '#0a0a0a',
    fontWeight: '700',
    fontSize: 16,
  },
});
