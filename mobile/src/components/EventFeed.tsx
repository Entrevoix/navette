import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { EventFrame, AssistantEvent, TextBlock } from '../types';

interface EventFeedProps {
  events: EventFrame[];
}

function eventSummary(frame: EventFrame): { label: string; detail: string; color: string } {
  const ev = frame.event;
  switch (ev.type) {
    case 'assistant': {
      const ae = ev as AssistantEvent;
      const text = ae.message.content.find((b: { type: string }): b is TextBlock => b.type === 'text');
      const tools = ae.message.content.filter((b: { type: string }) => b.type === 'tool_use');
      if (tools.length > 0) {
        const names = tools.map((t: { type: string }) => (t as { type: 'tool_use'; name: string }).name).join(', ');
        return { label: 'tool call', detail: names, color: '#93c5fd' };
      }
      return { label: 'assistant', detail: text?.text.slice(0, 120) ?? '', color: '#a3e635' };
    }
    case 'tool_result':
      return { label: 'result', detail: String((ev as { type: string; content?: unknown }).content ?? '').slice(0, 120), color: '#fb923c' };
    case 'system':
      return { label: 'system', detail: (ev as { type: string; subtype?: string }).subtype ?? '', color: '#6b7280' };
    case 'result':
      return { label: 'done', detail: '', color: '#4ade80' };
    default:
      return { label: ev.type, detail: '', color: '#6b7280' };
  }
}

function EventRow({ frame }: { frame: EventFrame }) {
  const { label, detail, color } = eventSummary(frame);
  const time = new Date(frame.ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <View style={styles.row}>
      <Text style={styles.seq}>#{frame.seq}</Text>
      <View style={styles.body}>
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color }]}>{label}</Text>
          <Text style={styles.time}>{time}</Text>
        </View>
        {detail.length > 0 && (
          <Text style={styles.detail} numberOfLines={2}>{detail}</Text>
        )}
      </View>
    </View>
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
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  seq: {
    color: '#333',
    fontSize: 11,
    width: 36,
    paddingTop: 2,
  },
  body: {
    flex: 1,
  },
  labelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  time: {
    color: '#444',
    fontSize: 11,
  },
  detail: {
    color: '#888',
    fontSize: 13,
    lineHeight: 18,
  },
});
