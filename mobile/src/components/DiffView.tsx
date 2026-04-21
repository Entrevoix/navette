// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

type HunkState = 'pending' | 'accepted' | 'reverted';

interface Hunk {
  header: string;
  lines: string[];
  index: number;
}

interface DiffViewProps {
  content: string;
  showHunkControls?: boolean;
  onHunkReviewComplete?: (summary: { accepted: number; reverted: number; total: number }) => void;
}

function parseHunks(lines: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;

  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current) hunks.push(current);
      current = { header: line, lines: [], index: hunks.length };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

export function DiffView({ content, showHunkControls, onHunkReviewComplete }: DiffViewProps) {
  const [expanded, setExpanded] = useState(false);
  const [hunkStates, setHunkStates] = useState<Map<number, HunkState>>(new Map());

  if (!content.includes('\n+') && !content.includes('\n-') && !content.includes('@@')) {
    return null;
  }

  const lines = content.split('\n');
  const hasDiff = lines.some(l => l.startsWith('+') || l.startsWith('-') || l.startsWith('@@'));
  if (!hasDiff) return null;

  const added = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).length;
  const removed = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).length;
  const hunks = parseHunks(lines);
  const hasHunks = showHunkControls && hunks.length > 0;

  const toggleHunk = useCallback((index: number, state: HunkState) => {
    setHunkStates(prev => {
      const next = new Map(prev);
      const current = next.get(index);
      if (current === state) {
        next.delete(index);
      } else {
        next.set(index, state);
      }
      if (onHunkReviewComplete) {
        let accepted = 0;
        let reverted = 0;
        next.forEach(v => { if (v === 'accepted') accepted++; else if (v === 'reverted') reverted++; });
        onHunkReviewComplete({ accepted, reverted, total: hunks.length });
      }
      return next;
    });
  }, [hunks.length, onHunkReviewComplete]);

  const renderLine = (line: string, i: number, hunkState?: HunkState) => {
    const isAdded = line.startsWith('+') && !line.startsWith('+++');
    const isRemoved = line.startsWith('-') && !line.startsWith('---');
    const isReverted = hunkState === 'reverted';
    return (
      <Text
        key={i}
        style={[
          styles.line,
          isAdded && styles.lineAdded,
          isRemoved && styles.lineRemoved,
          isReverted && styles.lineReverted,
        ]}
        numberOfLines={1}
      >
        {line || ' '}
      </Text>
    );
  };

  return (
    <View style={styles.container}>
      <Pressable style={styles.header} onPress={() => setExpanded(x => !x)}>
        <Text style={styles.headerText}>
          Diff {expanded ? '▼' : '▶'}
        </Text>
        <View style={styles.stats}>
          {added > 0 && <Text style={styles.added}>+{added}</Text>}
          {removed > 0 && <Text style={styles.removed}>-{removed}</Text>}
        </View>
      </Pressable>
      {expanded && (
        <ScrollView style={styles.body} horizontal>
          <View>
            {hasHunks ? (
              hunks.map((hunk) => {
                const state = hunkStates.get(hunk.index) ?? 'pending';
                return (
                  <View key={hunk.index}>
                    <View style={styles.hunkHeaderRow}>
                      <Text style={[styles.line, styles.lineHunk, { flex: 1 }]} numberOfLines={1}>
                        {hunk.header}
                      </Text>
                      <Pressable
                        style={[styles.hunkBtn, state === 'accepted' && styles.hunkBtnAccepted]}
                        onPress={() => toggleHunk(hunk.index, 'accepted')}
                      >
                        <Text style={styles.hunkBtnText}>✓</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.hunkBtn, state === 'reverted' && styles.hunkBtnReverted]}
                        onPress={() => toggleHunk(hunk.index, 'reverted')}
                      >
                        <Text style={styles.hunkBtnText}>✗</Text>
                      </Pressable>
                    </View>
                    <View style={[
                      styles.hunkBody,
                      state === 'accepted' && styles.hunkBodyAccepted,
                      state === 'reverted' && styles.hunkBodyReverted,
                    ]}>
                      {hunk.lines.map((line, i) => renderLine(line, i, state))}
                    </View>
                  </View>
                );
              })
            ) : (
              lines.map((line, i) => renderLine(line, i))
            )}
          </View>
        </ScrollView>
      )}
      {expanded && hasHunks && hunkStates.size > 0 && (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            {Array.from(hunkStates.values()).filter(v => v === 'accepted').length}/{hunks.length} accepted
            {Array.from(hunkStates.values()).some(v => v === 'reverted') &&
              `, ${Array.from(hunkStates.values()).filter(v => v === 'reverted').length} rejected`}
          </Text>
          <Text style={styles.summaryHint}>Review hunks, then approve or deny the full change</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 6, borderRadius: 6, borderWidth: 1, borderColor: '#2a2a2a', overflow: 'hidden' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#111' },
  headerText: { color: '#6b7280', fontSize: 11, fontWeight: '600' },
  stats: { flexDirection: 'row', gap: 8 },
  added: { color: '#4ade80', fontSize: 11, fontWeight: '700' },
  removed: { color: '#f87171', fontSize: 11, fontWeight: '700' },
  body: { maxHeight: 240, backgroundColor: '#0a0a0a' },
  line: { fontFamily: 'Menlo', fontSize: 11, paddingHorizontal: 10, paddingVertical: 1, color: '#a1a1aa' },
  lineAdded: { backgroundColor: '#0a2a0a', color: '#4ade80' },
  lineRemoved: { backgroundColor: '#2a0a0a', color: '#f87171' },
  lineHunk: { color: '#60a5fa', backgroundColor: '#0a0f1a' },
  lineReverted: { opacity: 0.35, textDecorationLine: 'line-through' },
  hunkHeaderRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0a0f1a' },
  hunkBtn: {
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 4,
    marginHorizontal: 2,
  },
  hunkBtnAccepted: { backgroundColor: '#14532d' },
  hunkBtnReverted: { backgroundColor: '#450a0a' },
  hunkBtnText: { color: '#a1a1aa', fontSize: 12, fontWeight: '700' },
  hunkBody: { borderLeftWidth: 2, borderLeftColor: 'transparent' },
  hunkBodyAccepted: { borderLeftColor: '#4ade80' },
  hunkBodyReverted: { borderLeftColor: '#f87171' },
  summaryBar: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#111',
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  summaryText: { color: '#93c5fd', fontSize: 11, fontWeight: '600' },
  summaryHint: { color: '#52525b', fontSize: 10, marginTop: 2 },
});
