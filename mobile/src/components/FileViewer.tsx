// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

interface FileViewerProps {
  path: string;
  content: string | null;
  size?: number;
  error?: string;
  loading?: boolean;
  onEdit?: () => void;
}

function isClaudePath(path: string): boolean {
  return path.includes('/.claude/');
}

export function FileViewer({ path, content, size, error, loading, onEdit }: FileViewerProps) {
  const theme = useTheme();
  const filename = path.split('/').pop() ?? path;

  if (loading) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { backgroundColor: theme.colors.surfaceVariant, borderBottomColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.filename, { color: theme.colors.onSurface }]} numberOfLines={1}>{filename}</Text>
        </View>
        <View style={styles.center}>
          <Text style={[styles.statusText, { color: theme.colors.onSurfaceVariant }]}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { backgroundColor: theme.colors.surfaceVariant, borderBottomColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.filename, { color: theme.colors.onSurface }]} numberOfLines={1}>{filename}</Text>
        </View>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: theme.colors.error }]}>{error}</Text>
        </View>
      </View>
    );
  }

  if (content === null) return null;

  const lines = content.split('\n');
  const lineNumWidth = String(lines.length).length;

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.header, { backgroundColor: theme.colors.surfaceVariant, borderBottomColor: theme.colors.outlineVariant }]}>
        <Text style={[styles.filename, { color: theme.colors.onSurface }]} numberOfLines={1}>{filename}</Text>
        <View style={styles.headerRight}>
          {size !== undefined && (
            <Text style={[styles.sizeLabel, { color: theme.colors.onSurfaceVariant }]}>
              {size < 1024 ? `${size}B` : `${Math.round(size / 1024)}KB`}
            </Text>
          )}
          {isClaudePath(path) && onEdit && (
            <Pressable style={[styles.editBtn, { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.primary }]} onPress={onEdit}>
              <Text style={[styles.editBtnText, { color: theme.colors.primary }]}>Edit</Text>
            </Pressable>
          )}
        </View>
      </View>
      <ScrollView style={[styles.body, { backgroundColor: theme.colors.background }]} horizontal>
        <ScrollView style={styles.innerScroll} nestedScrollEnabled>
          {lines.map((line, i) => (
            <View key={i} style={styles.lineRow}>
              <Text style={[styles.lineNum, { color: theme.colors.onSurfaceVariant }]}>
                {String(i + 1).padStart(lineNumWidth, ' ')}
              </Text>
              <Text selectable style={[styles.lineText, { color: theme.colors.onSurface }]}>{line || ' '}</Text>
            </View>
          ))}
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  filename: { fontSize: 13, fontWeight: '600', flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sizeLabel: { fontSize: 11 },
  editBtn: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
  },
  editBtnText: { fontSize: 12, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  statusText: { fontSize: 13 },
  errorText: { fontSize: 13, textAlign: 'center' },
  body: { flex: 1 },
  innerScroll: { flex: 1 },
  lineRow: { flexDirection: 'row', paddingHorizontal: 8, minHeight: 20 },
  lineNum: {
    fontFamily: 'Menlo',
    fontSize: 11,
    width: 36,
    textAlign: 'right',
    marginRight: 12,
    paddingVertical: 1,
  },
  lineText: {
    fontFamily: 'Menlo',
    fontSize: 11,
    flex: 1,
    paddingVertical: 1,
  },
});
