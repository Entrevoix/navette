// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SessionInfo, SessionPhase } from '../types';

interface KanbanBoardProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  hasUnread: (sessionId: string) => boolean;
}

function classifyPhase(
  session: SessionInfo,
  hasUnread: (id: string) => boolean,
): SessionPhase {
  if (hasUnread(session.session_id)) return 'waiting';
  return 'running';
}

const PHASE_META: Record<SessionPhase, { label: string; color: string; bg: string; border: string }> = {
  running: { label: 'Running', color: '#4ade80', bg: '#0d1a0d', border: '#166534' },
  waiting: { label: 'Waiting', color: '#fbbf24', bg: '#1c1500', border: '#78350f' },
  complete: { label: 'Complete', color: '#93c5fd', bg: '#0d1a2e', border: '#1e3a5f' },
  failed: { label: 'Failed', color: '#f87171', bg: '#1c0a0a', border: '#7f1d1d' },
};

const PHASE_ORDER: SessionPhase[] = ['waiting', 'running', 'complete', 'failed'];

export function KanbanBoard({ sessions, activeSessionId, onSelect, hasUnread }: KanbanBoardProps) {
  const grouped = new Map<SessionPhase, SessionInfo[]>();
  for (const phase of PHASE_ORDER) grouped.set(phase, []);

  for (const s of sessions) {
    const phase = classifyPhase(s, hasUnread);
    grouped.get(phase)!.push(s);
  }

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.board}>
      {PHASE_ORDER.map(phase => {
        const meta = PHASE_META[phase];
        const items = grouped.get(phase) ?? [];
        return (
          <View key={phase} style={[styles.column, { borderColor: meta.border }]}>
            <View style={[styles.columnHeader, { backgroundColor: meta.bg }]}>
              <Text style={[styles.columnLabel, { color: meta.color }]}>{meta.label}</Text>
              <Text style={[styles.columnCount, { color: meta.color }]}>{items.length}</Text>
            </View>
            {items.length === 0 ? (
              <View style={styles.emptyCol}>
                <Text style={styles.emptyColText}>—</Text>
              </View>
            ) : (
              items.map(s => {
                const isActive = s.session_id === activeSessionId;
                const unread = hasUnread(s.session_id);
                return (
                  <Pressable
                    key={s.session_id}
                    style={[styles.card, isActive && styles.cardActive]}
                    onPress={() => onSelect(s.session_id)}
                  >
                    {unread && !isActive && <View style={styles.unreadDot} />}
                    <Text style={styles.cardPrompt} numberOfLines={2}>
                      {s.prompt.length > 50 ? s.prompt.slice(0, 50) + '…' : s.prompt}
                    </Text>
                    {s.container ? (
                      <Text style={styles.cardContainer} numberOfLines={1}>{s.container}</Text>
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  board: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 10,
  },
  column: {
    width: 160,
    borderRadius: 10,
    borderWidth: 1,
    backgroundColor: '#111',
    overflow: 'hidden',
  },
  columnHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  columnLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  columnCount: {
    fontSize: 11,
    fontWeight: '700',
  },
  emptyCol: {
    padding: 16,
    alignItems: 'center',
  },
  emptyColText: {
    color: '#333',
    fontSize: 13,
  },
  card: {
    margin: 6,
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  cardActive: {
    borderColor: '#4a9eff',
    backgroundColor: '#1a1a2e',
  },
  cardPrompt: {
    color: '#e0e0e0',
    fontSize: 12,
    lineHeight: 16,
  },
  cardContainer: {
    color: '#6b7280',
    fontSize: 10,
    fontFamily: 'Menlo',
    marginTop: 4,
  },
  unreadDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#ef4444',
  },
});
