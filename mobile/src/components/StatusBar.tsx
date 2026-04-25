// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { ContextMeter } from './ContextMeter';

interface StatusBarProps {
  agentName: string;
  containerName: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  maxTokens: number;
  sessionRunning: boolean;
  onContainerPress?: () => void;
}

export function StatusBar({
  agentName,
  containerName,
  inputTokens,
  outputTokens,
  cacheTokens,
  maxTokens,
  sessionRunning,
  onContainerPress,
}: StatusBarProps) {
  const theme = useTheme();
  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background, borderBottomColor: theme.colors.outlineVariant }]}>
      <View style={styles.left}>
        <Text style={[styles.agentLabel, { color: theme.colors.primary }]}>{agentName}</Text>
        <Pressable onPress={onContainerPress} hitSlop={6} style={[styles.containerChip, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.containerText, { color: theme.colors.onSurfaceVariant }]}>{containerName || 'host'}</Text>
        </Pressable>
      </View>
      {sessionRunning ? (
        <ContextMeter
          inputTokens={inputTokens}
          outputTokens={outputTokens}
          cacheTokens={cacheTokens}
          maxTokens={maxTokens}
        />
      ) : (
        <Text style={[styles.idleLabel, { color: theme.colors.onSurfaceVariant }]}>idle</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderBottomWidth: 1,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  agentLabel: {
    fontSize: 12,
    fontWeight: '700',
  },
  containerChip: {
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderWidth: 1,
  },
  containerText: {
    fontSize: 11,
    fontWeight: '500',
  },
  idleLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
});
