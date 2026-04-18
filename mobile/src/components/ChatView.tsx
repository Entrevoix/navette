import React, { useEffect, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ApprovalCard } from './ApprovalCard';
import {
  AssistantEvent,
  EventFrame,
  PendingApproval,
  TextBlock,
  ToolUseBlock,
} from '../types';

interface ChatViewProps {
  events: EventFrame[];
  pendingApprovals: PendingApproval[];
  onDecide: (tool_use_id: string, allow: boolean) => void;
  viewStartSeq: number;
  activeSessionId?: string | null;
}

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

function summarizeInput(name: string, input: Record<string, unknown>): string {
  if (name === 'Bash' && input.command) return String(input.command).slice(0, 120);
  if (input.path) return String(input.path).slice(0, 120);
  if (input.file_path) return String(input.file_path).slice(0, 120);
  if (input.pattern) return String(input.pattern).slice(0, 120);
  const first = Object.values(input)[0];
  return first ? String(first).slice(0, 120) : '';
}

function ToolCallRow({
  name, input, resultContent, isPending, onDecide, approval,
}: {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  resultContent: string | undefined;
  isPending: boolean;
  onDecide: (id: string, allow: boolean) => void;
  approval?: PendingApproval;
}) {
  const [expanded, setExpanded] = useState(false);
  const summary = summarizeInput(name, input);

  if (isPending && approval) {
    return <ApprovalCard approval={approval} onDecide={onDecide} />;
  }

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
          <Text selectable style={tcStyles.code}>{JSON.stringify(input, null, 2)}</Text>
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

export function ChatView({ events, pendingApprovals, onDecide, viewStartSeq, activeSessionId }: ChatViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => { setShowHistory(false); }, [viewStartSeq]);

  const sessionEvents = activeSessionId
    ? events.filter(f => (f.event as { session_id?: string }).session_id === activeSessionId)
    : events;
  const visibleEvents = showHistory ? sessionEvents : sessionEvents.filter(f => f.seq > viewStartSeq);
  const resultMap = buildResultMap(visibleEvents);
  const pendingMap = new Map(pendingApprovals.map(a => [a.tool_use_id, a]));

  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  }, [visibleEvents.length, pendingApprovals.length]);

  const items: React.ReactNode[] = [];

  for (const frame of visibleEvents) {
    const ev = frame.event;

    if (ev.type === 'session_started') {
      const s = ev as { type: string; prompt?: string };
      items.push(
        <View key={`ss-${frame.seq}`} style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerLabel}>session</Text>
          <View style={styles.dividerLine} />
        </View>
      );
      if (s.prompt) {
        items.push(
          <View key={`up-${frame.seq}`} style={styles.userBubble}>
            <Text selectable style={styles.userText}>{s.prompt}</Text>
          </View>
        );
      }
      continue;
    }

    if (ev.type === 'session_ended') {
      const e = ev as { type: string; ok: boolean };
      items.push(
        <View key={`se-${frame.seq}`} style={styles.dividerRow}>
          <View style={styles.dividerLine} />
          <Text style={[styles.dividerLabel, e.ok ? styles.doneLabel : styles.failLabel]}>
            {e.ok ? 'done' : 'failed'}
          </Text>
          <View style={styles.dividerLine} />
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
            <Text key={`t-${frame.seq}-${i}`} selectable style={styles.assistantText}>
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
              isPending={pendingMap.has(tb.id)}
              onDecide={onDecide}
              approval={pendingMap.get(tb.id)}
            />
          );
        }
      }
      continue;
    }
  }

  const hasHistory = sessionEvents.some(f => f.seq <= viewStartSeq);

  if (items.length === 0 && !hasHistory) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No conversation yet</Text>
      </View>
    );
  }

  if (items.length === 0 && hasHistory) {
    return (
      <View style={styles.empty}>
        <Pressable onPress={() => setShowHistory(true)} style={styles.historyToggle}>
          <Text style={styles.historyToggleText}>▼ Show history</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {hasHistory && (
        <Pressable onPress={() => setShowHistory(x => !x)} style={styles.historyToggle}>
          <Text style={styles.historyToggleText}>
            {showHistory ? '▲ Hide history' : '▼ Show history'}
          </Text>
        </Pressable>
      )}
      {items}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24, gap: 10 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#71717a', fontSize: 14 },
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
  historyToggle: { alignItems: 'center', paddingVertical: 6 },
  historyToggleText: { color: '#52525b', fontSize: 11 },
});
