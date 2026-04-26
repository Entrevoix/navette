// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Button, useTheme } from 'react-native-paper';
import { SavedConfig } from '../types';

interface ServerPickerProps {
  visible: boolean;
  configs: SavedConfig[];
  currentHost: string;
  currentPort: string;
  onSelect: (config: SavedConfig) => void;
  onEditServers: () => void;
  onClose: () => void;
}

export function ServerPicker({
  visible,
  configs,
  currentHost,
  currentPort,
  onSelect,
  onEditServers,
  onClose,
}: ServerPickerProps) {
  const theme = useTheme();

  const isCurrent = (cfg: SavedConfig) =>
    cfg.host === currentHost && cfg.port === currentPort;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <View
          style={[styles.modal, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant }]}
          onStartShouldSetResponder={() => true}
        >
          <Text style={[styles.title, { color: theme.colors.onSurfaceVariant, borderBottomColor: theme.colors.outlineVariant }]}>
            Switch Server
          </Text>

          {configs.length === 0 ? (
            <Text style={[styles.empty, { color: theme.colors.onSurfaceVariant }]}>No saved servers</Text>
          ) : (
            <ScrollView style={styles.list}>
              {configs.map(cfg => {
                const active = isCurrent(cfg);
                return (
                  <Pressable
                    key={cfg.id}
                    style={[
                      styles.row,
                      { borderBottomColor: theme.colors.outlineVariant },
                      active && { backgroundColor: theme.colors.primaryContainer },
                    ]}
                    onPress={() => { if (!active) { onSelect(cfg); onClose(); } }}
                  >
                    <View style={[styles.dot, { backgroundColor: active ? theme.colors.primary : 'transparent' }]} />
                    <View style={styles.rowInfo}>
                      <Text style={[styles.rowName, { color: theme.colors.onSurface }, active && { color: theme.colors.primary }]}>
                        {cfg.name}
                      </Text>
                      <Text style={[styles.rowHost, { color: theme.colors.onSurfaceVariant }]}>
                        {cfg.host}:{cfg.port}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}

          <View style={[styles.footer, { borderTopColor: theme.colors.outlineVariant }]}>
            <Button mode="text" onPress={onEditServers} compact>Edit Servers</Button>
            <Button mode="text" onPress={onClose} compact>Cancel</Button>
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modal: {
    borderRadius: 14,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    overflow: 'hidden',
  },
  title: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  empty: { fontSize: 14, padding: 16, textAlign: 'center' },
  list: { maxHeight: 280 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowInfo: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '500' },
  rowHost: { fontSize: 12, marginTop: 2, fontFamily: 'Menlo' },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
});
