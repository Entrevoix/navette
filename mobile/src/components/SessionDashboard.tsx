// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { SessionCard } from './SessionCard';
import type { PendingApproval, SessionInfo } from '../types';

interface SessionDashboardProps {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  pendingApprovals: PendingApproval[];
  onSelectSession: (id: string) => void;
}

export function SessionDashboard({
  sessions,
  activeSessionId,
  pendingApprovals,
  onSelectSession,
}: SessionDashboardProps) {
  if (sessions.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No active sessions</Text>
        <Text style={styles.emptyHint}>Start one with ▶</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={sessions}
      numColumns={2}
      keyExtractor={s => s.session_id}
      contentContainerStyle={styles.grid}
      columnWrapperStyle={styles.row}
      renderItem={({ item }) => {
        return (
          <SessionCard
            session={item}
            isActive={item.session_id === activeSessionId}
            hasPendingApproval={pendingApprovals.length > 0}
            onSelect={onSelectSession}
          />
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  grid: {
    padding: 12,
  },
  row: {
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    color: '#6b7280',
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 6,
  },
  emptyHint: {
    color: '#52525b',
    fontSize: 13,
  },
});
