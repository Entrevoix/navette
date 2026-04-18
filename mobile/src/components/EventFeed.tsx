import React, { useState } from 'react';
import { FlatList, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { EventFrame, AssistantEvent, TextBlock } from '../types';

interface EventFeedProps {
  events: EventFrame[];
}

interface EventSummary {
  label: string;
  detail: string;
  color: string;
  fullContent: string;
}

function eventSummary(frame: EventFrame): EventSummary {
  const ev = frame.event;
  switch (ev.type) {
    case 'assistant': {
      const ae = ev as AssistantEvent;
      const text = ae.message.content.find((b: { type: string }): b is TextBlock => b.type === 'text');
      const tools = ae.message.content.filter((b: { type: string }) => b.type === 'tool_use');
      if (tools.length > 0) {
        const names = tools.map((t: { type: string }) => (t as { type: 'tool_use'; name: string }).name).join(', ');
        const fullTools = tools.map((t: unknown) => JSON.stringify(t, null, 2)).join('\n\n');
        return { label: 'tool call', detail: names, color: '#93c5fd', fullContent: fullTools };
      }
      const fullText = text?.text ?? '';
      return { label: 'assistant', detail: fullText.slice(0, 120), color: '#a3e635', fullContent: fullText };
    }
    case 'tool_result': {
      const raw = String((ev as { type: string; content?: unknown }).content ?? '');
      const fullContent = raw.length > 50_000 ? raw.slice(0, 50_000) + '\n…[truncated]' : raw;
      return { label: 'result', detail: raw.slice(0, 120), color: '#fb923c', fullContent };
    }
    case 'system': {
      const subtype = (ev as { type: string; subtype?: string }).subtype ?? '';
      const full = JSON.stringify(ev, null, 2);
      return { label: 'system', detail: subtype, color: '#6b7280', fullContent: full };
    }
    case 'result': {
      const full = JSON.stringify(ev, null, 2);
      return { label: 'done', detail: '', color: '#4ade80', fullContent: full };
    }
    default: {
      const full = JSON.stringify(ev, null, 2);
      return { label: ev.type, detail: '', color: '#6b7280', fullContent: full };
    }
  }
}

function EventRow({ frame }: { frame: EventFrame }) {
  const [expanded, setExpanded] = useState(false);
  const { label, detail, color, fullContent } = eventSummary(frame);
  const time = new Date(frame.ts * 1000).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <Pressable onPress={() => setExpanded(x => !x)} style={styles.row}>
      <Text style={styles.seq}>#{frame.seq}</Text>
      <View style={styles.body}>
        <View style={styles.labelRow}>
          <View style={[styles.pill, { backgroundColor: color + '22', borderColor: color + '55' }]}>
            <Text style={[styles.label, { color }]}>{label}</Text>
          </View>
          <Text style={styles.time}>{time}</Text>
        </View>
        {!expanded && detail.length > 0 && (
          <Text style={styles.detail} numberOfLines={2}>{detail}</Text>
        )}
        {expanded && fullContent.length > 0 && (
          <Text selectable style={styles.fullContent}>{fullContent}</Text>
        )}
      </View>
    </Pressable>
  );
}

export function EventFeed({ events }: EventFeedProps) {
  if (events.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>Waiting for events…</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={[...events].reverse()}
      keyExtractor={(item: EventFrame) => String(item.seq)}
      renderItem={({ item }: { item: EventFrame }) => <EventRow frame={item} />}
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
    color: '#444',
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  seq: {
    color: '#333',
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
    color: '#3a3a3a',
    fontSize: 11,
  },
  detail: {
    color: '#777',
    fontSize: 13,
    lineHeight: 18,
  },
  fullContent: {
    color: '#bbb',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    fontSize: 12,
    lineHeight: 18,
  },
});
