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
import type { SecretEntry } from '../types';

interface SecretsScreenProps {
  visible: boolean;
  onClose: () => void;
  secrets: SecretEntry[];
  onRefresh: () => void;
  onSave: (name: string, value: string) => void;
  onDelete: (name: string) => void;
}

export function SecretsScreen({ visible, onClose, secrets, onRefresh, onSave, onDelete }: SecretsScreenProps) {
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (visible) onRefresh();
  }, [visible, onRefresh]);

  const handleSave = () => {
    const n = name.trim();
    const v = value.trim();
    if (!n || !v) return;
    onSave(n, v);
    setName('');
    setValue('');
    setEditing(false);
  };

  const handleDelete = (secretName: string) => {
    Alert.alert('Delete Secret', `Remove "${secretName}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(secretName) },
    ]);
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Secrets</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.banner}>
          <Text style={styles.bannerText}>
            Secrets are encrypted at rest and injected as environment variables into CLI sessions. Values are write-only — they cannot be read back.
          </Text>
        </View>

        <FlatList
          data={secrets}
          keyExtractor={s => s.name}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No secrets stored yet.</Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={styles.rowInfo}>
                <Text style={styles.secretName}>{item.name}</Text>
                <Text style={styles.secretMasked}>{item.masked}</Text>
              </View>
              <Pressable style={styles.updateBtn} onPress={() => { setName(item.name); setValue(''); setEditing(true); }}>
                <Text style={styles.updateBtnText}>Update</Text>
              </Pressable>
              <Pressable style={styles.deleteBtn} onPress={() => handleDelete(item.name)}>
                <Text style={styles.deleteBtnText}>Delete</Text>
              </Pressable>
            </View>
          )}
        />

        {editing ? (
          <View style={styles.form}>
            <Text style={styles.formLabel}>{secrets.some(s => s.name === name.trim()) ? `Update: ${name}` : `New: ${name || '…'}`}</Text>
            <TextInput
              style={styles.formInput}
              value={name}
              onChangeText={setName}
              placeholder="SECRET_NAME"
              placeholderTextColor="#444"
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TextInput
              style={styles.formInput}
              value={value}
              onChangeText={setValue}
              placeholder="secret value"
              placeholderTextColor="#444"
              autoCorrect={false}
              secureTextEntry
            />
            <View style={styles.formActions}>
              <Pressable style={styles.cancelBtn} onPress={() => { setEditing(false); setName(''); setValue(''); }}>
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.saveBtn, (!name.trim() || !value.trim()) && styles.saveBtnDisabled]}
                onPress={handleSave}
                disabled={!name.trim() || !value.trim()}
              >
                <Text style={styles.saveBtnText}>Save</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.addRow}>
            <Pressable style={styles.addBtn} onPress={() => setEditing(true)}>
              <Text style={styles.addBtnText}>+ Add Secret</Text>
            </Pressable>
          </View>
        )}
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
  banner: {
    margin: 16, padding: 12, borderRadius: 8,
    backgroundColor: '#1a1500', borderWidth: 1, borderColor: '#3a2e00',
  },
  bannerText: { color: '#fbbf24', fontSize: 12, lineHeight: 18 },
  list: { paddingHorizontal: 16, paddingBottom: 12 },
  emptyText: { color: '#555', fontSize: 14, textAlign: 'center', paddingVertical: 32 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1a1a1a',
  },
  rowInfo: { flex: 1 },
  secretName: { color: '#f0f0f0', fontSize: 14, fontWeight: '600', fontFamily: 'Menlo' },
  secretMasked: { color: '#555', fontSize: 12, fontFamily: 'Menlo', marginTop: 2 },
  updateBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#111',
  },
  updateBtnText: { color: '#888', fontSize: 12, fontWeight: '600' },
  deleteBtn: {
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
    borderWidth: 1, borderColor: '#3a1a1a', backgroundColor: '#1a0a0a',
  },
  deleteBtnText: { color: '#f87171', fontSize: 12, fontWeight: '600' },
  form: { padding: 16, gap: 10, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  formLabel: { color: '#888', fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  formInput: {
    backgroundColor: '#0d0d0d', borderRadius: 8, borderWidth: 1, borderColor: '#2a2a2a',
    padding: 12, color: '#f0f0f0', fontSize: 13, fontFamily: 'Menlo',
  },
  formActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  cancelBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8,
    borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#111',
  },
  cancelBtnText: { color: '#888', fontSize: 13, fontWeight: '600' },
  saveBtn: {
    paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8,
    backgroundColor: '#166534',
  },
  saveBtnDisabled: { opacity: 0.35 },
  saveBtnText: { color: '#f0f0f0', fontSize: 13, fontWeight: '700' },
  addRow: { padding: 16, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  addBtn: {
    backgroundColor: '#111', borderRadius: 8, paddingVertical: 14,
    alignItems: 'center', borderWidth: 1, borderColor: '#2a2a2a',
  },
  addBtnText: { color: '#4ade80', fontSize: 15, fontWeight: '700' },
});
