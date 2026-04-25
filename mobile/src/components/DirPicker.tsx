// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useState } from 'react';
import { Modal, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { DirEntry, DirListingEvent } from '../types';

interface DirPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  listDir: (path: string, cb: (ev: DirListingEvent) => void) => void;
  initialPath?: string;
}

export function DirPicker({ visible, onClose, onSelect, listDir, initialPath = '~' }: DirPickerProps) {
  const theme = useTheme();
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const navigate = (path: string) => {
    setLoading(true);
    setError(null);
    listDir(path, (ev) => {
      setLoading(false);
      if (ev.error) {
        setError(ev.error);
      } else {
        setCurrentPath(ev.path);
        setEntries(ev.entries.sort((a: DirEntry, b: DirEntry) =>
          a.is_dir === b.is_dir ? a.name.localeCompare(b.name) : a.is_dir ? -1 : 1
        ));
      }
    });
  };

  useEffect(() => {
    if (visible) navigate(initialPath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pathParts = currentPath.split('/').filter(Boolean);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={[styles.cancelText, { color: theme.colors.onSurfaceVariant }]}>Cancel</Text>
          </Pressable>
          <Text style={[styles.title, { color: theme.colors.onSurface }]} numberOfLines={1}>Choose Directory</Text>
          <Pressable onPress={() => { onSelect(currentPath); onClose(); }} style={[styles.selectBtn, { backgroundColor: theme.colors.primaryContainer }]}>
            <Text style={[styles.selectText, { color: theme.colors.primary }]}>Select</Text>
          </Pressable>
        </View>

        {/* Breadcrumb */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.breadcrumb, { borderBottomColor: theme.colors.outlineVariant }]}>
          <Pressable onPress={() => navigate('/')} style={styles.crumb}>
            <Text style={[styles.crumbText, { color: theme.colors.onSurfaceVariant }]}>/</Text>
          </Pressable>
          {pathParts.map((part, i) => (
            <Pressable
              key={i}
              onPress={() => navigate('/' + pathParts.slice(0, i + 1).join('/'))}
              style={styles.crumb}
            >
              <Text style={[
                styles.crumbText,
                { color: theme.colors.onSurfaceVariant },
                i === pathParts.length - 1 && { color: theme.colors.onSurface, fontWeight: '600' },
              ]}>
                {part}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Entries */}
        {loading && <Text style={[styles.status, { color: theme.colors.onSurfaceVariant }]}>Loading…</Text>}
        {error && <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>}
        <ScrollView style={styles.list}>
          {currentPath !== '/' && (
            <Pressable onPress={() => navigate(currentPath + '/..')} style={[styles.entry, { borderBottomColor: theme.colors.outlineVariant }]}>
              <Text style={styles.entryIcon}>📁</Text>
              <Text style={[styles.entryName, { color: theme.colors.onSurface }]}>..</Text>
            </Pressable>
          )}
          {entries.map(entry => (
            <Pressable
              key={entry.name}
              style={[styles.entry, { borderBottomColor: theme.colors.outlineVariant }]}
              onPress={() => entry.is_dir ? navigate(currentPath + '/' + entry.name) : undefined}
            >
              <Text style={styles.entryIcon}>{entry.is_dir ? '📁' : '📄'}</Text>
              <Text style={[styles.entryName, { color: entry.is_dir ? theme.colors.onSurface : theme.colors.onSurfaceVariant }]}>
                {entry.name}
              </Text>
            </Pressable>
          ))}
        </ScrollView>

        {/* Current path footer */}
        <View style={[styles.footer, { borderTopColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.footerPath, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>{currentPath}</Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
    borderBottomWidth: 1,
  },
  cancelBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  cancelText: { fontSize: 15 },
  title: { fontSize: 15, fontWeight: '600', flex: 1, textAlign: 'center' },
  selectBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  selectText: { fontSize: 15, fontWeight: '700' },
  breadcrumb: {
    flexGrow: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  crumb: { paddingHorizontal: 6, paddingVertical: 2 },
  crumbText: { fontSize: 13 },
  status: { textAlign: 'center', paddingVertical: 20, fontSize: 13 },
  errorText: { textAlign: 'center', paddingVertical: 20, fontSize: 13 },
  list: { flex: 1 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  entryIcon: { fontSize: 16, marginRight: 12 },
  entryName: { fontSize: 14 },
  footer: { padding: 12, borderTopWidth: 1 },
  footerPath: { fontSize: 11, fontFamily: 'Menlo' },
});
