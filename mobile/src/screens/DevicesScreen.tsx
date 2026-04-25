// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, useTheme } from 'react-native-paper';
import type { DeviceEntry } from '../types';

interface DevicesScreenProps {
  visible: boolean;
  onClose: () => void;
  devices: DeviceEntry[];
  onRefresh: () => void;
  onRevoke: (deviceId: string) => void;
  onRename: (deviceId: string, name: string) => void;
}

function relativeTime(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function DevicesScreen({ visible, onClose, devices, onRefresh, onRevoke, onRename }: DevicesScreenProps) {
  const theme = useTheme();
  const [renameTarget, setRenameTarget] = useState<DeviceEntry | null>(null);
  const [renameText, setRenameText] = useState('');

  useEffect(() => {
    if (visible) onRefresh();
  }, [visible, onRefresh]);

  const handleRevoke = (device: DeviceEntry) => {
    Alert.alert(
      'Revoke Device',
      `Revoke "${device.name}"? It will no longer be able to connect.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Revoke', style: 'destructive', onPress: () => onRevoke(device.device_id) },
      ],
    );
  };

  const handleRename = (device: DeviceEntry) => {
    setRenameText(device.name);
    setRenameTarget(device);
  };

  const submitRename = () => {
    const trimmed = renameText.trim();
    if (trimmed && renameTarget) {
      onRename(renameTarget.device_id, trimmed);
    }
    setRenameTarget(null);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>Paired Devices</Text>
          <Button mode="text" onPress={onClose}>Done</Button>
        </View>

        <FlatList
          data={devices}
          keyExtractor={d => d.device_id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>No paired devices yet.</Text>
          }
          renderItem={({ item }) => (
            <View style={[styles.row, { borderBottomColor: theme.colors.outlineVariant }, item.revoked && styles.rowRevoked]}>
              <View style={styles.rowInfo}>
                <Text style={[styles.deviceName, { color: theme.colors.onSurface }]}>{item.name}</Text>
                <Text style={[styles.deviceId, { color: theme.colors.onSurfaceVariant }]}>{item.device_id.slice(0, 16)}{item.device_id.length > 16 ? '…' : ''}</Text>
                <Text style={[styles.deviceMeta, { color: theme.colors.onSurfaceVariant }]}>
                  {item.revoked ? 'Revoked' : `Last seen ${relativeTime(item.last_seen)}`}
                </Text>
              </View>
              {!item.revoked && (
                <Button mode="outlined" compact onPress={() => handleRename(item)}>Rename</Button>
              )}
              {!item.revoked ? (
                <Button mode="outlined" compact onPress={() => handleRevoke(item)} textColor={theme.colors.error} style={{ borderColor: theme.colors.error }}>Revoke</Button>
              ) : (
                <View style={[styles.revokedBadge, { backgroundColor: theme.colors.surfaceVariant }]}>
                  <Text style={[styles.revokedBadgeText, { color: theme.colors.onSurfaceVariant }]}>Revoked</Text>
                </View>
              )}
            </View>
          )}
        />

        <Modal visible={renameTarget !== null} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
          <View style={styles.overlay}>
            <View style={[styles.dialog, { backgroundColor: theme.colors.surfaceVariant }]}>
              <Text style={[styles.dialogTitle, { color: theme.colors.onSurface }]}>Rename Device</Text>
              <TextInput
                style={[styles.dialogInput, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
                value={renameText}
                onChangeText={setRenameText}
                placeholder="Device name"
                placeholderTextColor={theme.colors.onSurfaceVariant}
                autoFocus
                onSubmitEditing={submitRename}
                returnKeyType="done"
              />
              <View style={styles.dialogButtons}>
                <Button mode="text" onPress={() => setRenameTarget(null)}>Cancel</Button>
                <Button mode="contained-tonal" onPress={submitRename}>Rename</Button>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 12 },
  emptyText: { fontSize: 14, textAlign: 'center', paddingVertical: 32 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, borderBottomWidth: 1,
  },
  rowRevoked: { opacity: 0.5 },
  rowInfo: { flex: 1 },
  deviceName: { fontSize: 14, fontWeight: '600' },
  deviceId: { fontSize: 11, fontFamily: 'Menlo', marginTop: 2 },
  deviceMeta: { fontSize: 12, marginTop: 4 },
  revokedBadge: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
  },
  revokedBadgeText: { fontSize: 12, fontWeight: '600' },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  dialog: {
    borderRadius: 12, padding: 20, width: '100%', maxWidth: 340,
  },
  dialogTitle: { fontSize: 16, fontWeight: '700', marginBottom: 12 },
  dialogInput: {
    borderRadius: 8, borderWidth: 1,
    fontSize: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16,
  },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
});
