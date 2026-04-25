// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';

interface QuickResponseButtonsProps {
  text: string;
  onSendInput: (text: string) => void;
}

function stripCodeBlocks(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/`[^`]+`/g, '');
}

function detectButtons(text: string): string[] | null {
  const cleaned = stripCodeBlocks(text).trim();
  if (!cleaned) return null;

  const lastLine = cleaned.split('\n').filter(l => l.trim()).pop() ?? '';
  const lastChunk = cleaned.slice(-300);

  if (/\(y\/n\)/i.test(lastChunk) || /\[y\/n\]/i.test(lastChunk)) {
    return ['Yes', 'No'];
  }

  if (/\(approve\/deny\)/i.test(lastChunk) || /\(allow\/reject\)/i.test(lastChunk)) {
    return ['Approve', 'Deny'];
  }

  if (/continue\?/i.test(lastLine)) {
    return ['Continue', 'Stop'];
  }

  const numbered = lastChunk.match(/^\s*(\d+)[.)]\s+.+/gm);
  if (numbered && numbered.length >= 2 && numbered.length <= 6) {
    return numbered.map(line => {
      const m = line.match(/^\s*(\d+)[.)]\s+(.+)/);
      return m ? m[1] : line.trim();
    });
  }

  if (lastLine.endsWith('?') && lastLine.length > 10 && lastLine.length < 200) {
    return ['Yes', 'No'];
  }

  return null;
}

export function QuickResponseButtons({ text, onSendInput }: QuickResponseButtonsProps) {
  const theme = useTheme();
  const buttons = detectButtons(text);
  if (!buttons) return null;

  return (
    <View style={styles.container}>
      {buttons.map((label) => (
        <Pressable
          key={label}
          style={[styles.pill, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant }]}
          onPress={() => onSendInput(label)}
        >
          <Text style={[styles.pillText, { color: theme.colors.primary }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export { detectButtons };

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 16,
    borderWidth: 1,
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
  },
});
