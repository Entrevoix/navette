// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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
  const filename = path.split('/').pop() ?? path;

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.filename} numberOfLines={1}>{filename}</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.statusText}>Loading...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.filename} numberOfLines={1}>{filename}</Text>
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      </View>
    );
  }

  if (content === null) return null;

  const lines = content.split('\n');
  const lineNumWidth = String(lines.length).length;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.filename} numberOfLines={1}>{filename}</Text>
        <View style={styles.headerRight}>
          {size !== undefined && (
            <Text style={styles.sizeLabel}>
              {size < 1024 ? `${size}B` : `${Math.round(size / 1024)}KB`}
            </Text>
          )}
          {isClaudePath(path) && onEdit && (
            <Pressable style={styles.editBtn} onPress={onEdit}>
              <Text style={styles.editBtnText}>Edit</Text>
            </Pressable>
          )}
        </View>
      </View>
      <ScrollView style={styles.body} horizontal>
        <ScrollView style={styles.innerScroll} nestedScrollEnabled>
          {lines.map((line, i) => (
            <View key={i} style={styles.lineRow}>
              <Text style={styles.lineNum}>
                {String(i + 1).padStart(lineNumWidth, ' ')}
              </Text>
              <Text selectable style={styles.lineText}>{line || ' '}</Text>
            </View>
          ))}
        </ScrollView>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    backgroundColor: '#111',
  },
  filename: { color: '#e2e8f0', fontSize: 13, fontWeight: '600', flex: 1 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sizeLabel: { color: '#6b7280', fontSize: 11 },
  editBtn: {
    backgroundColor: '#1e3a5f',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: '#2d5a9e',
  },
  editBtnText: { color: '#93c5fd', fontSize: 12, fontWeight: '700' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  statusText: { color: '#6b7280', fontSize: 13 },
  errorText: { color: '#f87171', fontSize: 13, textAlign: 'center' },
  body: { flex: 1, backgroundColor: '#0a0a0a' },
  innerScroll: { flex: 1 },
  lineRow: { flexDirection: 'row', paddingHorizontal: 8, minHeight: 20 },
  lineNum: {
    fontFamily: 'Menlo',
    fontSize: 11,
    color: '#3f3f46',
    width: 36,
    textAlign: 'right',
    marginRight: 12,
    paddingVertical: 1,
  },
  lineText: {
    fontFamily: 'Menlo',
    fontSize: 11,
    color: '#a1a1aa',
    flex: 1,
    paddingVertical: 1,
  },
});
