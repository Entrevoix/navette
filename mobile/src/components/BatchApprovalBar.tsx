// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import * as Haptics from 'expo-haptics';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { PendingApproval } from '../types';

interface BatchApprovalBarProps {
  pendingApprovals: PendingApproval[];
  onBatchDecide: (allow: boolean) => void;
}

export function BatchApprovalBar({ pendingApprovals, onBatchDecide }: BatchApprovalBarProps) {
  const theme = useTheme();
  const count = pendingApprovals.length;
  if (count < 2) return null;

  const handleApproveAll = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onBatchDecide(true);
  };

  const handleDenyAll = () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    onBatchDecide(false);
  };

  return (
    <View style={[styles.bar, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant }]}>
      <Text style={[styles.count, { color: theme.colors.primary }]}>{count} pending approvals</Text>
      <View style={styles.actions}>
        <Pressable style={[styles.denyAllBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]} onPress={handleDenyAll}>
          <Text style={[styles.denyAllText, { color: theme.colors.onSurfaceVariant }]}>Deny All</Text>
        </Pressable>
        <Pressable style={[styles.approveAllBtn, { backgroundColor: theme.colors.primaryContainer }]} onPress={handleApproveAll}>
          <Text style={[styles.approveAllText, { color: theme.colors.primary }]}>Approve All ({count})</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    gap: 10,
  },
  count: {
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  approveAllBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
  },
  approveAllText: {
    fontWeight: '700',
    fontSize: 14,
  },
  denyAllBtn: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
  },
  denyAllText: {
    fontWeight: '600',
    fontSize: 14,
  },
});
