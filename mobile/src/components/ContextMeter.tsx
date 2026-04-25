// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

interface ContextMeterProps {
  inputTokens: number;
  outputTokens: number;
  cacheTokens: number;
  maxTokens: number;
}

function formatK(n: number): string {
  if (n === 0) return '0';
  return `${(n / 1000).toFixed(0)}k`;
}

export function ContextMeter({ inputTokens, outputTokens, maxTokens }: ContextMeterProps) {
  const theme = useTheme();
  const totalUsed = inputTokens + outputTokens;
  const pct = maxTokens > 0 ? Math.min((totalUsed / maxTokens) * 100, 100) : 0;

  let barColor = theme.colors.primary;
  if (pct >= 80) barColor = theme.colors.error;
  else if (pct >= 60) barColor = theme.colors.tertiary;

  return (
    <View style={styles.container}>
      <View style={[styles.barBg, { backgroundColor: theme.colors.surfaceVariant }]}>
        <View style={[styles.barFill, { width: `${pct}%`, backgroundColor: barColor }]} />
      </View>
      <Text style={[styles.label, { color: barColor }]}>
        {formatK(totalUsed)}/{formatK(maxTokens)} ({pct.toFixed(0)}%)
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  barBg: {
    width: 48,
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 3,
  },
  label: {
    fontSize: 10,
    fontWeight: '600',
  },
});
