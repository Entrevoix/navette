// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useState } from 'react';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from 'react-native-paper';
import { DiffView } from './DiffView';
import { toolInputToDiff } from '../utils/diff';
import {
  AssistantEvent,
  EventFrame,
  TextBlock,
  ToolUseBlock,
} from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildResultMap(events: EventFrame[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const frame of events) {
    if (frame.event.type === 'tool_result') {
      const ev = frame.event as { type: 'tool_result'; tool_use_id: string; content: string };
      map.set(ev.tool_use_id, String(ev.content ?? ''));
    }
  }
  return map;
}

export function summarizeInput(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash' && input.command) return String(input.command).slice(0, 120);
  if (input.path) return String(input.path).slice(0, 120);
  if (input.file_path) return String(input.file_path).slice(0, 120);
  if (input.pattern) return String(input.pattern).slice(0, 120);
  const first = Object.values(input)[0];
  return first ? String(first).slice(0, 120) : '';
}

// ---------------------------------------------------------------------------
// ToolCallRow — collapsible tool-use block with result + diff
// ---------------------------------------------------------------------------

interface ToolCallRowProps {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  resultContent: string | undefined;
}

export function ToolCallRow({ toolUseId: _toolUseId, name, input, resultContent }: ToolCallRowProps) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeInput(name, input);
  const diffLines = toolInputToDiff(name, input);

  return (
    <View style={[tcStyles.container, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surface }]}>
      <Pressable onPress={() => setExpanded(x => !x)} style={tcStyles.header}>
        <View style={tcStyles.nameRow}>
          <Text style={[tcStyles.status, resultContent !== undefined ? { color: theme.colors.primary } : { color: theme.colors.onSurfaceVariant }]}>
            {resultContent !== undefined ? '✓' : '·'}
          </Text>
          <Text style={[tcStyles.toolName, { color: theme.colors.primary }]}>{name}</Text>
          {!expanded && summary.length > 0 && (
            <Text style={[tcStyles.summary, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>{summary}</Text>
          )}
        </View>
        <Text style={[tcStyles.chevron, { color: theme.colors.onSurfaceVariant }]}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>
      {expanded && (
        <View style={[tcStyles.body, { borderTopColor: theme.colors.outlineVariant }]}>
          {diffLines ? <DiffView lines={diffLines} /> : (
            <Text selectable style={[tcStyles.code, { color: theme.colors.onSurface }]}>{JSON.stringify(input, null, 2)}</Text>
          )}
          {resultContent !== undefined && (
            <>
              <View style={[tcStyles.divider, { backgroundColor: theme.colors.outlineVariant }]} />
              <Text selectable style={[tcStyles.result, { color: theme.colors.tertiary }]}>
                {resultContent.length > 4000 ? resultContent.slice(0, 4000) + '\n…' : resultContent}
              </Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

const tcStyles = StyleSheet.create({
  container: {
    borderRadius: 8,
    borderWidth: 1,
    overflow: 'hidden',
    marginVertical: 2,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  status: { fontSize: 12, width: 14 },
  toolName: { fontSize: 13, fontWeight: '600' },
  summary: {
    fontSize: 12,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    flex: 1,
  },
  chevron: { fontSize: 10, marginLeft: 8 },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderTopWidth: 1,
  },
  code: {
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    fontSize: 11,
    lineHeight: 17,
    paddingTop: 8,
  },
  divider: { height: 1, marginVertical: 8 },
  result: {
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    fontSize: 11,
    lineHeight: 17,
  },
});

// ---------------------------------------------------------------------------
// EventLog — read-only scrollable event list (no input bar, no approvals)
// ---------------------------------------------------------------------------

const MAX_SHARE_EVENTS = 500;

export function eventsToPlainText(events: EventFrame[]): string {
  const capped = events.slice(0, MAX_SHARE_EVENTS);
  const lines: string[] = [];
  for (const frame of capped) {
    const ev = frame.event;
    if (ev.type === 'session_started') {
      lines.push(`[${frame.ts}] session started`);
    } else if (ev.type === 'session_ended') {
      const e = ev as { type: string; ok: boolean };
      lines.push(`[${frame.ts}] session ${e.ok ? 'done' : 'failed'}`);
    } else if (ev.type === 'assistant') {
      const ae = ev as AssistantEvent;
      for (const block of ae.message.content) {
        if (block.type === 'text') {
          const text = (block as TextBlock).text.trim();
          if (text) lines.push(`[${frame.ts}] assistant: ${text.slice(0, 200)}`);
        } else if (block.type === 'tool_use') {
          const tu = block as ToolUseBlock;
          lines.push(`[${frame.ts}] tool: ${tu.name} ${summarizeInput(tu.name, tu.input)}`);
        }
      }
    } else if (ev.type === 'tool_result') {
      lines.push(`[${frame.ts}] result`);
    }
  }
  if (events.length > MAX_SHARE_EVENTS) {
    lines.push(`…${events.length - MAX_SHARE_EVENTS} more events omitted`);
  }
  return lines.join('\n');
}

interface EventLogProps {
  events: EventFrame[];
  onClear?: () => void;
}

export function EventLog({ events, onClear }: EventLogProps) {
  const theme = useTheme();

  if (events.length === 0) {
    return (
      <View style={elStyles.empty}>
        <Text style={[elStyles.emptyText, { color: theme.colors.onSurfaceVariant }]}>Loading events…</Text>
      </View>
    );
  }

  const handleShare = async () => {
    const text = eventsToPlainText(events);
    await Share.share({ message: text });
  };

  const handleClear = () => {
    if (!onClear) return;
    Alert.alert('Clear events', 'Remove all events from the log?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: onClear },
    ]);
  };

  const resultMap = buildResultMap(events);
  const items: React.ReactNode[] = [];

  for (const frame of events) {
    const ev = frame.event;

    if (ev.type === 'session_started') {
      const s = ev as { type: string; prompt?: string };
      items.push(
        <View key={`ss-${frame.seq}`} style={elStyles.dividerRow}>
          <View style={[elStyles.dividerLine, { backgroundColor: theme.colors.outlineVariant }]} />
          <Text style={[elStyles.dividerLabel, { color: theme.colors.onSurfaceVariant }]}>session</Text>
          <View style={[elStyles.dividerLine, { backgroundColor: theme.colors.outlineVariant }]} />
        </View>
      );
      if (s.prompt) {
        items.push(
          <View key={`up-${frame.seq}`} style={[elStyles.userBubble, { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.primary }]}>
            <Text selectable style={[elStyles.userText, { color: theme.colors.onPrimaryContainer }]}>{s.prompt}</Text>
          </View>
        );
      }
      continue;
    }

    if (ev.type === 'session_ended') {
      const e = ev as { type: string; ok: boolean };
      items.push(
        <View key={`se-${frame.seq}`} style={elStyles.dividerRow}>
          <View style={[elStyles.dividerLine, { backgroundColor: theme.colors.outlineVariant }]} />
          <Text style={[elStyles.dividerLabel, e.ok ? { color: theme.colors.primary } : { color: theme.colors.error }]}>
            {e.ok ? 'done' : 'failed'}
          </Text>
          <View style={[elStyles.dividerLine, { backgroundColor: theme.colors.outlineVariant }]} />
        </View>
      );
      continue;
    }

    if (ev.type === 'assistant') {
      const ae = ev as AssistantEvent;
      for (let i = 0; i < ae.message.content.length; i++) {
        const block = ae.message.content[i];
        if (block.type === 'text') {
          const tb = block as TextBlock;
          if (!tb.text.trim()) continue;
          items.push(
            <Text key={`t-${frame.seq}-${i}`} selectable style={[elStyles.assistantText, { color: theme.colors.onSurface }]}>
              {tb.text}
            </Text>
          );
        } else if (block.type === 'tool_use') {
          const tb = block as ToolUseBlock;
          items.push(
            <ToolCallRow
              key={`tc-${tb.id}`}
              toolUseId={tb.id}
              name={tb.name}
              input={tb.input}
              resultContent={resultMap.get(tb.id)}
            />
          );
        }
      }
      continue;
    }
  }

  return (
    <View style={elStyles.wrapper}>
      <View style={[elStyles.actionBar, { borderBottomColor: theme.colors.outlineVariant }]}>
        <Pressable onPress={handleShare} style={[elStyles.actionBtn, { borderColor: theme.colors.outlineVariant }]}>
          <Text style={[elStyles.actionText, { color: theme.colors.onSurfaceVariant }]}>Share</Text>
        </Pressable>
        {onClear && (
          <Pressable onPress={handleClear} style={[elStyles.actionBtn, { borderColor: theme.colors.outlineVariant }]}>
            <Text style={[elStyles.actionText, { color: theme.colors.error }]}>Clear</Text>
          </Pressable>
        )}
      </View>
      <ScrollView style={elStyles.scroll} contentContainerStyle={elStyles.content}>
        {items}
      </ScrollView>
    </View>
  );
}

const elStyles = StyleSheet.create({
  wrapper: { flex: 1 },
  actionBar: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
  },
  actionText: { fontSize: 12, fontWeight: '600' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24, gap: 10 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  emptyText: { fontSize: 13 },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  dividerLine: { flex: 1, height: 1 },
  dividerLabel: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  userBubble: {
    alignSelf: 'flex-end',
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
    maxWidth: '88%',
  },
  userText: { fontSize: 14, lineHeight: 20 },
  assistantText: {
    fontSize: 14,
    lineHeight: 22,
  },
});
