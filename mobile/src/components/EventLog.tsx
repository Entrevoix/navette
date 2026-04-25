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
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeInput(name, input);
  const diffLines = toolInputToDiff(name, input);

  return (
    <View style={tcStyles.container}>
      <Pressable onPress={() => setExpanded(x => !x)} style={tcStyles.header}>
        <View style={tcStyles.nameRow}>
          <Text style={[tcStyles.status, resultContent !== undefined ? tcStyles.statusDone : tcStyles.statusPending]}>
            {resultContent !== undefined ? '✓' : '·'}
          </Text>
          <Text style={tcStyles.toolName}>{name}</Text>
          {!expanded && summary.length > 0 && (
            <Text style={tcStyles.summary} numberOfLines={1}>{summary}</Text>
          )}
        </View>
        <Text style={tcStyles.chevron}>{expanded ? '▲' : '▼'}</Text>
      </Pressable>
      {expanded && (
        <View style={tcStyles.body}>
          {diffLines ? <DiffView lines={diffLines} /> : (
            <Text selectable style={tcStyles.code}>{JSON.stringify(input, null, 2)}</Text>
          )}
          {resultContent !== undefined && (
            <>
              <View style={tcStyles.divider} />
              <Text selectable style={tcStyles.result}>
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
    borderColor: '#222',
    backgroundColor: '#0d0d0d',
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
  statusDone: { color: '#4ade80' },
  statusPending: { color: '#71717a' },
  toolName: { color: '#93c5fd', fontSize: 13, fontWeight: '600' },
  summary: {
    color: '#7e8ea0',
    fontSize: 12,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    flex: 1,
  },
  chevron: { color: '#6b7280', fontSize: 10, marginLeft: 8 },
  body: {
    paddingHorizontal: 12,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  code: {
    color: '#b8bfca',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    fontSize: 11,
    lineHeight: 17,
    paddingTop: 8,
  },
  divider: { height: 1, backgroundColor: '#1a1a1a', marginVertical: 8 },
  result: {
    color: '#fb923c',
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
  if (events.length === 0) {
    return (
      <View style={elStyles.empty}>
        <Text style={elStyles.emptyText}>Loading events…</Text>
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
          <View style={elStyles.dividerLine} />
          <Text style={elStyles.dividerLabel}>session</Text>
          <View style={elStyles.dividerLine} />
        </View>
      );
      if (s.prompt) {
        items.push(
          <View key={`up-${frame.seq}`} style={elStyles.userBubble}>
            <Text selectable style={elStyles.userText}>{s.prompt}</Text>
          </View>
        );
      }
      continue;
    }

    if (ev.type === 'session_ended') {
      const e = ev as { type: string; ok: boolean };
      items.push(
        <View key={`se-${frame.seq}`} style={elStyles.dividerRow}>
          <View style={elStyles.dividerLine} />
          <Text style={[elStyles.dividerLabel, e.ok ? elStyles.doneLabel : elStyles.failLabel]}>
            {e.ok ? 'done' : 'failed'}
          </Text>
          <View style={elStyles.dividerLine} />
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
            <Text key={`t-${frame.seq}-${i}`} selectable style={elStyles.assistantText}>
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
      <View style={elStyles.actionBar}>
        <Pressable onPress={handleShare} style={elStyles.actionBtn}>
          <Text style={elStyles.actionText}>Share</Text>
        </Pressable>
        {onClear && (
          <Pressable onPress={handleClear} style={elStyles.actionBtn}>
            <Text style={[elStyles.actionText, elStyles.clearText]}>Clear</Text>
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
    borderBottomColor: '#1e1e1e',
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  actionText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  clearText: { color: '#f87171' },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24, gap: 10 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  emptyText: { color: '#71717a', fontSize: 13 },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 4,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#1e1e1e' },
  dividerLabel: {
    color: '#6b7280',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  doneLabel: { color: '#4ade80' },
  failLabel: { color: '#f87171' },
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
  assistantText: {
    color: '#d4d4d8',
    fontSize: 14,
    lineHeight: 22,
  },
});
