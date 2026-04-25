// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { DiffLine } from '../utils/diff';

const MAX_LINES = 80;

interface DiffViewProps {
  lines: DiffLine[];
}

const COLORS: Record<DiffLine['type'], { bg: string; text: string; gutter: string }> = {
  add: { bg: '#0d2818', text: '#4ade80', gutter: '#22c55e' },
  remove: { bg: '#2d0f0f', text: '#f87171', gutter: '#ef4444' },
  context: { bg: 'transparent', text: '#71717a', gutter: '#52525b' },
};

const GUTTER: Record<DiffLine['type'], string> = { add: '+', remove: '-', context: ' ' };

export function DiffView({ lines }: DiffViewProps) {
  const added = lines.filter(l => l.type === 'add').length;
  const removed = lines.filter(l => l.type === 'remove').length;
  const truncated = lines.length > MAX_LINES;
  const visible = truncated ? lines.slice(0, MAX_LINES) : lines;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Diff</Text>
        <View style={styles.stats}>
          {added > 0 && <Text style={styles.added}>+{added}</Text>}
          {removed > 0 && <Text style={styles.removed}>-{removed}</Text>}
        </View>
      </View>
      <ScrollView style={styles.body} nestedScrollEnabled>
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
          <View style={styles.truncNotice}>
            <Text style={styles.truncText}>
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
    borderColor: '#1a1a1a',
    marginBottom: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#111',
  },
  headerText: { color: '#6b7280', fontSize: 11, fontWeight: '600' },
  stats: { flexDirection: 'row', gap: 8 },
  added: { color: '#4ade80', fontSize: 11, fontWeight: '700' },
  removed: { color: '#f87171', fontSize: 11, fontWeight: '700' },
  body: {
    maxHeight: 240,
    backgroundColor: '#0a0a0a',
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
    backgroundColor: '#111',
    paddingVertical: 4,
    alignItems: 'center',
  },
  truncText: {
    color: '#6b7280',
    fontSize: 10,
  },
});
