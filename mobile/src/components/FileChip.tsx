// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

interface FileChipProps {
  name: string;
  size: number;
  onRemove: () => void;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function truncateName(name: string, max: number = 20): string {
  if (name.length <= max) return name;
  const ext = name.lastIndexOf('.');
  if (ext > 0 && name.length - ext <= 6) {
    const extStr = name.slice(ext);
    return name.slice(0, max - extStr.length - 1) + '…' + extStr;
  }
  return name.slice(0, max - 1) + '…';
}

export function FileChip({ name, size, onRemove }: FileChipProps) {
  const theme = useTheme();
  return (
    <View style={[styles.chip, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant }]}>
      <Text style={[styles.name, { color: theme.colors.primary }]} numberOfLines={1}>{truncateName(name)}</Text>
      <Text style={[styles.size, { color: theme.colors.onSurfaceVariant }]}>{formatSize(size)}</Text>
      <Pressable onPress={onRemove} hitSlop={8} style={styles.removeBtn}>
        <Text style={[styles.removeText, { color: theme.colors.onSurfaceVariant }]}>✕</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  name: { fontSize: 12, fontWeight: '500', maxWidth: 140 },
  size: { fontSize: 10 },
  removeBtn: { padding: 2 },
  removeText: { fontSize: 12 },
});
