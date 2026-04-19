import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApprovalCard } from './ApprovalCard';
import { ToolCallRow } from './EventLog';
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
  sessionRunning?: boolean;
  onSendInput?: (text: string) => void;
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

function PendingToolCallRow({
  toolUseId, name, input, resultContent, isPending, onDecide, approval,
}: {
  toolUseId: string;
  name: string;
  input: Record<string, unknown>;
  resultContent: string | undefined;
  isPending: boolean;
  onDecide: (id: string, allow: boolean) => void;
  approval?: PendingApproval;
}) {
  if (isPending && approval) {
    return <ApprovalCard approval={approval} onDecide={onDecide} />;
  }
  return (
    <ToolCallRow
      toolUseId={toolUseId}
      name={name}
      input={input}
      resultContent={resultContent}
    />
  );
}

export function ChatView({ events, pendingApprovals, onDecide, viewStartSeq, activeSessionId, sessionRunning, onSendInput }: ChatViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [inputText, setInputText] = useState('');

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
            <PendingToolCallRow
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
  const hasPendingApprovals = pendingApprovals.length > 0;
  const showInputBar = sessionRunning && !!activeSessionId && !!onSendInput;

  const handleSendInput = () => {
    const text = inputText.trim();
    if (!text || !onSendInput) return;
    onSendInput(text);
    setInputText('');
  };

  const inputBar = showInputBar ? (
    <View style={styles.inputBar}>
      <TextInput
        style={[styles.inputField, hasPendingApprovals && styles.inputFieldDisabled]}
        value={inputText}
        onChangeText={setInputText}
        placeholder="Type a message…"
        placeholderTextColor="#52525b"
        autoCorrect={false}
        editable={!hasPendingApprovals}
        returnKeyType="send"
        onSubmitEditing={handleSendInput}
        blurOnSubmit={false}
      />
      <Pressable
        style={[styles.sendBtn, (!inputText.trim() || hasPendingApprovals) && styles.sendBtnDisabled]}
        onPress={handleSendInput}
        disabled={!inputText.trim() || hasPendingApprovals}
      >
        <Text style={styles.sendBtnText}>Send</Text>
      </Pressable>
    </View>
  ) : null;

  if (items.length === 0 && !hasHistory) {
    return (
      <View style={styles.emptyWrapper}>
        <View style={styles.empty}>
          <Text style={styles.emptyText}>No conversation yet</Text>
        </View>
        {inputBar}
      </View>
    );
  }

  if (items.length === 0 && hasHistory) {
    return (
      <View style={styles.emptyWrapper}>
        <View style={styles.empty}>
          <Pressable onPress={() => setShowHistory(true)} style={styles.historyToggle}>
            <Text style={styles.historyToggleText}>▼ Show history</Text>
          </Pressable>
        </View>
        {inputBar}
      </View>
    );
  }

  return (
    <View style={styles.chatWrapper}>
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
      {inputBar}
    </View>
  );
}

const styles = StyleSheet.create({
  chatWrapper: { flex: 1 },
  emptyWrapper: { flex: 1 },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 24, gap: 10 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { color: '#71717a', fontSize: 14 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e1e1e',
    backgroundColor: '#0a0a0a',
  },
  inputField: {
    flex: 1,
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 12,
    paddingVertical: 8,
    color: '#f0f0f0',
    fontSize: 14,
  },
  inputFieldDisabled: {
    opacity: 0.4,
  },
  sendBtn: {
    backgroundColor: '#1e3a5f',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: '#2d5a9e',
  },
  sendBtnDisabled: { opacity: 0.35 },
  sendBtnText: { color: '#93c5fd', fontWeight: '700', fontSize: 13 },
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
