// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import type { DiffLine } from '../utils/diff';

const MAX_LINES = 80;

interface DiffViewProps {
  lines: DiffLine[];
}

const GUTTER: Record<DiffLine['type'], string> = { add: '+', remove: '-', context: ' ' };

export function DiffView({ lines }: DiffViewProps) {
  const theme = useTheme();
  const added = lines.filter(l => l.type === 'add').length;
  const removed = lines.filter(l => l.type === 'remove').length;
  const truncated = lines.length > MAX_LINES;
  const visible = truncated ? lines.slice(0, MAX_LINES) : lines;

  const COLORS: Record<DiffLine['type'], { bg: string; text: string; gutter: string }> = {
    add: { bg: theme.colors.primaryContainer + '55', text: theme.colors.primary, gutter: theme.colors.primary },
    remove: { bg: theme.colors.errorContainer + '55', text: theme.colors.error, gutter: theme.colors.error },
    context: { bg: 'transparent', text: theme.colors.onSurfaceVariant, gutter: theme.colors.onSurfaceVariant },
  };

  return (
    <View style={[styles.container, { borderColor: theme.colors.outlineVariant }]}>
      <View style={[styles.header, { backgroundColor: theme.colors.surfaceVariant }]}>
        <Text style={[styles.headerText, { color: theme.colors.onSurfaceVariant }]}>Diff</Text>
        <View style={styles.stats}>
          {added > 0 && <Text style={[styles.added, { color: theme.colors.primary }]}>+{added}</Text>}
          {removed > 0 && <Text style={[styles.removed, { color: theme.colors.error }]}>-{removed}</Text>}
        </View>
      </View>
      <ScrollView style={[styles.body, { backgroundColor: theme.colors.background }]} nestedScrollEnabled>
        {visible.map((line, i) => {
          const c = COLORS[line.type];
          return (
            <View key={i} style={[styles.row, { backgroundColor: c.bg }]}>
              <Text style={[styles.gutter, { color: c.gutter }]}>{GUTTER[line.type]}</Text>
              <Text style={[styles.text, { color: c.text }]} numberOfLines={1}>
                {line.text || ' '}
              </Text>
            </View>
          );
        })}
        {truncated && (
          <View style={[styles.truncNotice, { backgroundColor: theme.colors.surfaceVariant }]}>
            <Text style={[styles.truncText, { color: theme.colors.onSurfaceVariant }]}>
              ... {lines.length - MAX_LINES} more lines
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const MONO = Platform.OS === 'android' ? 'monospace' : 'Menlo';

const styles = StyleSheet.create({
  container: {
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  headerText: { fontSize: 11, fontWeight: '600' },
  stats: { flexDirection: 'row', gap: 8 },
  added: { fontSize: 11, fontWeight: '700' },
  removed: { fontSize: 11, fontWeight: '700' },
  body: {
    maxHeight: 240,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 1,
    paddingRight: 8,
  },
  gutter: {
    width: 22,
    textAlign: 'center',
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 18,
  },
  text: {
    flex: 1,
    fontFamily: MONO,
    fontSize: 11,
    lineHeight: 18,
  },
  truncNotice: {
    paddingVertical: 4,
    alignItems: 'center',
  },
  truncText: {
    fontSize: 10,
  },
});
