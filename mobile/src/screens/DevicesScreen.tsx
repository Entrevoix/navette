// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Paired Devices</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>

        <FlatList
          data={devices}
          keyExtractor={d => d.device_id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No paired devices yet.</Text>
          }
          renderItem={({ item }) => (
            <View style={[styles.row, item.revoked && styles.rowRevoked]}>
              <View style={styles.rowInfo}>
                <Text style={styles.deviceName}>{item.name}</Text>
                <Text style={styles.deviceId}>{item.device_id.slice(0, 16)}{item.device_id.length > 16 ? '…' : ''}</Text>
                <Text style={styles.deviceMeta}>
                  {item.revoked ? 'Revoked' : `Last seen ${relativeTime(item.last_seen)}`}
                </Text>
              </View>
              {!item.revoked && (
                <Pressable style={styles.renameBtn} onPress={() => handleRename(item)}>
                  <Text style={styles.renameBtnText}>Rename</Text>
                </Pressable>
              )}
              {!item.revoked ? (
                <Pressable style={styles.revokeBtn} onPress={() => handleRevoke(item)}>
                  <Text style={styles.revokeBtnText}>Revoke</Text>
                </Pressable>
              ) : (
                <View style={styles.revokedBadge}>
                  <Text style={styles.revokedBadgeText}>Revoked</Text>
                </View>
              )}
            </View>
          )}
        />

        <Modal visible={renameTarget !== null} transparent animationType="fade" onRequestClose={() => setRenameTarget(null)}>
          <View style={styles.overlay}>
            <View style={styles.dialog}>
              <Text style={styles.dialogTitle}>Rename Device</Text>
              <TextInput
                style={styles.dialogInput}
                value={renameText}
                onChangeText={setRenameText}
                placeholder="Device name"
                placeholderTextColor="#555"
                autoFocus
                onSubmitEditing={submitRename}
                returnKeyType="done"
              />
              <View style={styles.dialogButtons}>
                <Pressable style={styles.dialogBtn} onPress={() => setRenameTarget(null)}>
                  <Text style={styles.dialogBtnCancel}>Cancel</Text>
                </Pressable>
                <Pressable style={styles.dialogBtn} onPress={submitRename}>
                  <Text style={styles.dialogBtnConfirm}>Rename</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  title: { color: '#f0f0f0', fontSize: 18, fontWeight: '700' },
  closeBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  closeText: { color: '#4ade80', fontSize: 15, fontWeight: '600' },
  list: { paddingHorizontal: 16, paddingBottom: 12 },
  emptyText: { color: '#555', fontSize: 14, textAlign: 'center', paddingVertical: 32 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  rowRevoked: { opacity: 0.5 },
  rowInfo: { flex: 1 },
  deviceName: { color: '#f0f0f0', fontSize: 14, fontWeight: '600' },
  deviceId: { color: '#555', fontSize: 11, fontFamily: 'Menlo', marginTop: 2 },
  deviceMeta: { color: '#888', fontSize: 12, marginTop: 4 },
  renameBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#111',
  },
  renameBtnText: { color: '#888', fontSize: 12, fontWeight: '600' },
  revokeBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: '#3a1a1a', backgroundColor: '#1a0a0a',
  },
  revokeBtnText: { color: '#f87171', fontSize: 12, fontWeight: '600' },
  revokedBadge: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
    backgroundColor: '#1a0a0a',
  },
  revokedBadgeText: { color: '#666', fontSize: 12, fontWeight: '600' },
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center', alignItems: 'center', padding: 32,
  },
  dialog: {
    backgroundColor: '#1a1a1a', borderRadius: 12, padding: 20, width: '100%', maxWidth: 340,
  },
  dialogTitle: { color: '#f0f0f0', fontSize: 16, fontWeight: '700', marginBottom: 12 },
  dialogInput: {
    backgroundColor: '#111', borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a',
    color: '#f0f0f0', fontSize: 14, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 16,
  },
  dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12 },
  dialogBtn: { paddingHorizontal: 14, paddingVertical: 8 },
  dialogBtnCancel: { color: '#888', fontSize: 14, fontWeight: '600' },
  dialogBtnConfirm: { color: '#4ade80', fontSize: 14, fontWeight: '600' },
});
