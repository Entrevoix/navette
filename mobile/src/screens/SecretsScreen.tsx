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
import { Button, IconButton, useTheme } from 'react-native-paper';
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
  const theme = useTheme();
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
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>Secrets</Text>
          <Button mode="text" onPress={onClose}>Done</Button>
        </View>

        <View style={[styles.banner, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.bannerText, { color: theme.colors.onSurfaceVariant }]}>
            Secrets are encrypted at rest and injected as environment variables into CLI sessions. Values are write-only — they cannot be read back.
          </Text>
        </View>

        <FlatList
          data={secrets}
          keyExtractor={s => s.name}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>No secrets stored yet.</Text>
          }
          renderItem={({ item }) => (
            <View style={[styles.row, { borderBottomColor: theme.colors.outlineVariant }]}>
              <View style={styles.rowInfo}>
                <Text style={[styles.secretName, { color: theme.colors.onSurface }]}>{item.name}</Text>
                <Text style={[styles.secretMasked, { color: theme.colors.onSurfaceVariant }]}>{item.masked}</Text>
              </View>
              <Button mode="outlined" compact onPress={() => { setName(item.name); setValue(''); setEditing(true); }}>Update</Button>
              <IconButton icon="delete" size={20} iconColor={theme.colors.error} onPress={() => handleDelete(item.name)} />
            </View>
          )}
        />

        {editing ? (
          <View style={[styles.form, { borderTopColor: theme.colors.outlineVariant }]}>
            <Text style={[styles.formLabel, { color: theme.colors.onSurfaceVariant }]}>{secrets.some(s => s.name === name.trim()) ? `Update: ${name}` : `New: ${name || '…'}`}</Text>
            <TextInput
              style={[styles.formInput, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
              value={name}
              onChangeText={setName}
              placeholder="SECRET_NAME"
              placeholderTextColor={theme.colors.onSurfaceVariant}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            <TextInput
              style={[styles.formInput, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
              value={value}
              onChangeText={(v: string) => setValue(v)}
              placeholder="secret value"
              placeholderTextColor={theme.colors.onSurfaceVariant}
              autoCorrect={false}
              secureTextEntry
            />
            <View style={styles.formActions}>
              <Button mode="outlined" onPress={() => { setEditing(false); setName(''); setValue(''); }}>Cancel</Button>
              <Button
                mode="contained-tonal"
                onPress={handleSave}
                disabled={!name.trim() || !value.trim()}
              >
                Save
              </Button>
            </View>
          </View>
        ) : (
          <View style={[styles.addRow, { borderTopColor: theme.colors.outlineVariant }]}>
            <Button mode="contained-tonal" onPress={() => setEditing(true)} style={styles.addBtn}>
              + Add Secret
            </Button>
          </View>
        )}
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
  banner: {
    margin: 16, padding: 12, borderRadius: 8,
    borderWidth: 1,
  },
  bannerText: { fontSize: 12, lineHeight: 18 },
  list: { paddingHorizontal: 16, paddingBottom: 12 },
  emptyText: { fontSize: 14, textAlign: 'center', paddingVertical: 32 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingVertical: 12, borderBottomWidth: 1,
  },
  rowInfo: { flex: 1 },
  secretName: { fontSize: 14, fontWeight: '600', fontFamily: 'Menlo' },
  secretMasked: { fontSize: 12, fontFamily: 'Menlo', marginTop: 2 },
  form: { padding: 16, gap: 10, borderTopWidth: 1 },
  formLabel: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  formInput: {
    borderRadius: 8, borderWidth: 1,
    padding: 12, fontSize: 13, fontFamily: 'Menlo',
  },
  formActions: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
  addRow: { padding: 16, borderTopWidth: 1 },
  addBtn: { width: '100%' },
});
