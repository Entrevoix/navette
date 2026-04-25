// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { useThemeMode } from '../ThemeContext';
import { getEventTypeColors } from '../theme';
import { EventFrame, AssistantEvent, TextBlock } from '../types';
import type { EventTypeColors } from '../theme';

interface EventFeedProps {
  events: EventFrame[];
}

interface EventSummary {
  label: string;
  detail: string;
  color: string;
  fullContent: string;
}

function eventSummary(frame: EventFrame, colors: EventTypeColors): EventSummary {
  const ev = frame.event;
  switch (ev.type) {
    case 'assistant': {
      const ae = ev as AssistantEvent;
      const text = ae.message.content.find((b: { type: string }): b is TextBlock => b.type === 'text');
      const tools = ae.message.content.filter((b: { type: string }) => b.type === 'tool_use');
      if (tools.length > 0) {
        const names = tools.map((t: { type: string }) => (t as { type: 'tool_use'; name: string }).name).join(', ');
        const fullTools = tools.map((t: unknown) => JSON.stringify(t, null, 2)).join('\n\n');
        return { label: 'tool call', detail: names, color: colors.toolCall, fullContent: fullTools };
      }
      const fullText = text?.text ?? '';
      return { label: 'assistant', detail: fullText.slice(0, 120), color: colors.assistant, fullContent: fullText };
    }
    case 'tool_result': {
      const raw = String((ev as { type: string; content?: unknown }).content ?? '');
      const fullContent = raw.length > 50_000 ? raw.slice(0, 50_000) + '\n…[truncated]' : raw;
      return { label: 'result', detail: raw.slice(0, 120), color: colors.result, fullContent };
    }
    case 'system': {
      const subtype = (ev as { type: string; subtype?: string }).subtype ?? '';
      const full = JSON.stringify(ev, null, 2);
      return { label: 'system', detail: subtype, color: colors.system, fullContent: full };
    }
    case 'result': {
      const full = JSON.stringify(ev, null, 2);
      return { label: 'done', detail: '', color: colors.done, fullContent: full };
    }
    default: {
      const full = JSON.stringify(ev, null, 2);
      return { label: ev.type, detail: '', color: colors.system, fullContent: full };
    }
  }
}

function EventRow({ frame, eventColors }: { frame: EventFrame; eventColors: EventTypeColors }) {
  const theme = useTheme();
  const [expanded, setExpanded] = useState(false);
  const { label, detail, color, fullContent } = eventSummary(frame, eventColors);
  const time = new Date(frame.ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <Pressable onPress={() => setExpanded(x => !x)} style={[styles.row, { borderBottomColor: theme.colors.outlineVariant }]}>
      <Text style={[styles.seq, { color: theme.colors.onSurfaceVariant }]}>#{frame.seq}</Text>
      <View style={styles.body}>
        <View style={styles.labelRow}>
          <View style={[styles.pill, { backgroundColor: color + '22', borderColor: color + '55' }]}>
            <Text style={[styles.label, { color }]}>{label}</Text>
          </View>
          <Text style={[styles.time, { color: theme.colors.onSurfaceVariant }]}>{time}</Text>
        </View>
        {!expanded && detail.length > 0 && (
          <Text style={[styles.detail, { color: theme.colors.onSurfaceVariant }]} numberOfLines={2}>{detail}</Text>
        )}
        {expanded && fullContent.length > 0 && (
          <Text selectable style={[styles.fullContent, { color: theme.colors.onSurface }]}>{fullContent}</Text>
        )}
      </View>
    </Pressable>
  );
}

export function EventFeed({ events }: EventFeedProps) {
  const theme = useTheme();
  const { isDark } = useThemeMode();
  const eventColors = getEventTypeColors(isDark);

  if (events.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>Waiting for events…</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={[...events].reverse()}
      keyExtractor={(item: EventFrame) => String(item.seq)}
      renderItem={({ item }: { item: EventFrame }) => <EventRow frame={item} eventColors={eventColors} />}
      contentContainerStyle={styles.list}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  list: {
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  seq: {
    fontSize: 11,
    width: 36,
    paddingTop: 3,
  },
  body: {
    flex: 1,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  pill: {
    borderRadius: 4,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  time: {
    fontSize: 11,
  },
  detail: {
    fontSize: 13,
    lineHeight: 18,
  },
  fullContent: {
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    fontSize: 12,
    lineHeight: 18,
  },
});
