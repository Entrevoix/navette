// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';
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

const PHASE_ORDER: SessionPhase[] = ['waiting', 'running', 'complete', 'failed'];

export function KanbanBoard({ sessions, activeSessionId, onSelect, hasUnread }: KanbanBoardProps) {
  const theme = useTheme();

  const PHASE_META: Record<SessionPhase, { label: string; color: string; border: string }> = {
    running: { label: 'Running', color: theme.colors.primary, border: theme.colors.primary },
    waiting: { label: 'Waiting', color: theme.colors.tertiary, border: theme.colors.tertiary },
    complete: { label: 'Complete', color: theme.colors.onSurfaceVariant, border: theme.colors.outlineVariant },
    failed: { label: 'Failed', color: theme.colors.error, border: theme.colors.error },
  };

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
          <View key={phase} style={[styles.column, { borderColor: meta.border, backgroundColor: theme.colors.surface }]}>
            <View style={[styles.columnHeader, { backgroundColor: theme.colors.surfaceVariant }]}>
              <Text style={[styles.columnLabel, { color: meta.color }]}>{meta.label}</Text>
              <Text style={[styles.columnCount, { color: meta.color }]}>{items.length}</Text>
            </View>
            {items.length === 0 ? (
              <View style={styles.emptyCol}>
                <Text style={[styles.emptyColText, { color: theme.colors.onSurfaceVariant }]}>—</Text>
              </View>
            ) : (
              items.map(s => {
                const isActive = s.session_id === activeSessionId;
                const unread = hasUnread(s.session_id);
                return (
                  <Pressable
                    key={s.session_id}
                    style={[
                      styles.card,
                      { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant },
                      isActive && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryContainer },
                    ]}
                    onPress={() => onSelect(s.session_id)}
                  >
                    {unread && !isActive && <View style={[styles.unreadDot, { backgroundColor: theme.colors.error }]} />}
                    <Text style={[styles.cardPrompt, { color: theme.colors.onSurface }]} numberOfLines={2}>
                      {s.prompt.length > 50 ? s.prompt.slice(0, 50) + '…' : s.prompt}
                    </Text>
                    {s.container ? (
                      <Text style={[styles.cardContainer, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>{s.container}</Text>
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
    fontSize: 13,
  },
  card: {
    margin: 6,
    padding: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  cardPrompt: {
    fontSize: 12,
    lineHeight: 16,
  },
  cardContainer: {
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
  },
});
