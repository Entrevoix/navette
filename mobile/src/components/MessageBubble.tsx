// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CodeBlock } from './CodeBlock';

interface MessageBubbleProps {
  text: string;
  role: 'assistant' | 'user';
}

interface Segment {
  type: 'text' | 'code';
  content: string;
  language?: string;
}

const FENCE_RE = /^```(\w*)\n([\s\S]*?)^```$/gm;

function splitTextAndCode(raw: string): Segment[] {
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
  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(text);
    } catch { /* clipboard unavailable */ }
  };

  if (role === 'user') {
    return (
      <View style={styles.userBubble}>
        <Text selectable style={styles.userText}>{text}</Text>
      </View>
    );
  }

  const segments = splitTextAndCode(text);

  return (
    <View style={styles.assistantBubble}>
      <Pressable onPress={handleCopy} hitSlop={8} style={styles.copyBtn}>
        <Text style={styles.copyIcon}>{'⎘'}</Text>
      </Pressable>
      <View style={styles.body}>
        {segments.map((seg, i) =>
          seg.type === 'code' ? (
            <CodeBlock key={i} code={seg.content} language={seg.language} />
          ) : (
            <Text key={i} selectable style={styles.assistantText}>{seg.content}</Text>
          )
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  assistantBubble: {
    position: 'relative',
  },
  copyBtn: {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 1,
    padding: 4,
    borderRadius: 4,
    backgroundColor: 'rgba(30,30,30,0.6)',
  },
  copyIcon: { color: '#6b7280', fontSize: 14 },
  body: {
    gap: 8,
    paddingRight: 28,
  },
  assistantText: {
    color: '#d4d4d8',
    fontSize: 14,
    lineHeight: 22,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#0f172a',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#1e3a5f',
    padding: 12,
    maxWidth: '88%',
  },
  userText: { color: '#93c5fd', fontSize: 14, lineHeight: 20 },
});
