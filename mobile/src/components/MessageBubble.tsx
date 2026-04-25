// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { IconButton, useTheme } from 'react-native-paper';
import { useSnackbar } from '../SnackbarContext';
import { CodeBlock } from './CodeBlock';

interface MessageBubbleProps {
  text: string;
  role: 'assistant' | 'user';
}

export interface Segment {
  type: 'text' | 'code';
  content: string;
  language?: string;
}

const FENCE_RE = /^```(\w*)\n([\s\S]*?)^```$/gm;

export function splitTextAndCode(raw: string): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0;

  for (const m of raw.matchAll(FENCE_RE)) {
    if (m.index! > cursor) {
      const before = raw.slice(cursor, m.index!).trim();
      if (before) segments.push({ type: 'text', content: before });
    }
    segments.push({ type: 'code', content: m[2].trimEnd(), language: m[1] || undefined });
    cursor = m.index! + m[0].length;
  }

  if (cursor < raw.length) {
    const after = raw.slice(cursor).trim();
    if (after) segments.push({ type: 'text', content: after });
  }

  return segments.length > 0 ? segments : [{ type: 'text', content: raw }];
}

export function MessageBubble({ text, role }: MessageBubbleProps) {
  const theme = useTheme();
  const { showSnackbar } = useSnackbar();
  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(text);
      showSnackbar('Copied');
    } catch { /* clipboard unavailable */ }
  };

  if (role === 'user') {
    return (
      <View style={[styles.userBubble, { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.primary }]}>
        <Text selectable style={[styles.userText, { color: theme.colors.onPrimaryContainer }]}>{text}</Text>
      </View>
    );
  }

  const segments = splitTextAndCode(text);

  return (
    <View style={styles.assistantBubble}>
      <IconButton icon="content-copy" size={14} onPress={handleCopy} style={styles.copyBtn} />
      <View style={styles.body}>
        {segments.map((seg, i) =>
          seg.type === 'code' ? (
            <CodeBlock key={i} code={seg.content} language={seg.language} />
          ) : (
            <Text key={i} selectable style={[styles.assistantText, { color: theme.colors.onSurface }]}>{seg.content}</Text>
          )
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  assistantBubble: { position: 'relative' },
  copyBtn: {
    position: 'absolute',
    top: -4,
    right: -4,
    zIndex: 1,
  },
  body: { gap: 8, paddingRight: 28 },
  assistantText: { fontSize: 14, lineHeight: 22 },
  userBubble: {
    alignSelf: 'flex-end',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    maxWidth: '88%',
  },
  userText: { fontSize: 14, lineHeight: 20 },
});
