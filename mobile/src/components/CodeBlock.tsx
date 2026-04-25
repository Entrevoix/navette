// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import * as Clipboard from 'expo-clipboard';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button, useTheme } from 'react-native-paper';
import { useSnackbar } from '../SnackbarContext';
import { monoFamily } from '../theme';

interface CodeBlockProps {
  code: string;
  language?: string;
}

const KEYWORDS = /\b(function|const|let|var|if|else|return|import|export|for|while|class|struct|fn|pub|use|mod|async|await|try|catch|throw|new|this|self|match|enum|impl|trait|type|interface|extends|implements|default|break|continue|switch|case|yield|from|as|of|in)\b/g;
const STRINGS = /(["'`])(?:(?!\1|\\).|\\.)*?\1/g;
const COMMENTS = /(\/\/.*$|\/\*[\s\S]*?\*\/|#.*$)/gm;
const NUMBERS = /\b(\d+\.?\d*)\b/g;

function highlightLine(line: string): React.ReactNode[] {
  const segments: { start: number; end: number; color: string }[] = [];

  for (const m of line.matchAll(COMMENTS)) {
    segments.push({ start: m.index!, end: m.index! + m[0].length, color: '#6b7280' });
  }
  for (const m of line.matchAll(STRINGS)) {
    segments.push({ start: m.index!, end: m.index! + m[0].length, color: '#a3e635' });
  }
  for (const m of line.matchAll(KEYWORDS)) {
    if (!segments.some(s => m.index! >= s.start && m.index! < s.end)) {
      segments.push({ start: m.index!, end: m.index! + m[0].length, color: '#93c5fd' });
    }
  }
  for (const m of line.matchAll(NUMBERS)) {
    if (!segments.some(s => m.index! >= s.start && m.index! < s.end)) {
      segments.push({ start: m.index!, end: m.index! + m[0].length, color: '#fb923c' });
    }
  }

  segments.sort((a, b) => a.start - b.start);

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.start > cursor) {
      parts.push(<Text key={`p-${i}`} style={styles.plain}>{line.slice(cursor, seg.start)}</Text>);
    }
    parts.push(<Text key={`s-${i}`} style={{ color: seg.color }}>{line.slice(seg.start, seg.end)}</Text>);
    cursor = seg.end;
  }
  if (cursor < line.length) {
    parts.push(<Text key="tail" style={styles.plain}>{line.slice(cursor)}</Text>);
  }

  return parts.length > 0 ? parts : [<Text key="line" style={styles.plain}>{line}</Text>];
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const theme = useTheme();
  const { showSnackbar } = useSnackbar();
  const handleCopy = async () => {
    try {
      await Clipboard.setStringAsync(code);
      showSnackbar('Copied');
    } catch { /* clipboard unavailable */ }
  };

  const lines = code.split('\n');

  return (
    <View style={[styles.container, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surfaceVariant }]}>
      <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
        {language ? <Text style={[styles.lang, { color: theme.colors.onSurfaceVariant }]}>{language}</Text> : <View />}
        <Button mode="text" compact onPress={handleCopy} labelStyle={{ fontSize: 11 }}>Copy</Button>
      </View>
      <View style={styles.codeArea}>
        {lines.map((line, i) => (
          <Text key={i} selectable style={[styles.codeLine, { color: theme.colors.onSurfaceVariant }]}>
            {highlightLine(line)}
          </Text>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    marginVertical: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderBottomWidth: 1,
  },
  lang: { fontSize: 11, fontWeight: '600' },
  codeArea: { padding: 10 },
  codeLine: {
    fontFamily: monoFamily,
    fontSize: 12,
    lineHeight: 18,
  },
  plain: {},
});
