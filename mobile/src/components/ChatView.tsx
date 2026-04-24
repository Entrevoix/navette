// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ApprovalCard } from './ApprovalCard';
import { BatchApprovalBar } from './BatchApprovalBar';
import { FileChip } from './FileChip';
import { MessageBubble } from './MessageBubble';
import { QuickResponseButtons } from './QuickResponseButtons';
import { ToolCallRow } from './EventLog';
import { exportTranscriptMarkdown } from '../utils/transcript';
import {
  AssistantEvent,
  EventFrame,
  PendingApproval,
  TextBlock,
  ToolUseBlock,
} from '../types';

type AttachedFile = { name: string; size: number; uri: string };

interface ChatViewProps {
  events: EventFrame[];
  pendingApprovals: PendingApproval[];
  onDecide: (tool_use_id: string, allow: boolean) => void;
  onBatchDecide?: (allow: boolean) => void;
  viewStartSeq: number;
  activeSessionId?: string | null;
  sessionRunning?: boolean;
  onSendInput?: (text: string) => void;
  onRefresh?: () => void;
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

export function ChatView({ events, pendingApprovals, onDecide, onBatchDecide, viewStartSeq, activeSessionId, sessionRunning, onSendInput, onRefresh }: ChatViewProps) {
  const scrollRef = useRef<ScrollView>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [inputText, setInputText] = useState('');
  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);

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
            <MessageBubble key={`t-${frame.seq}-${i}`} text={tb.text} role="assistant" />
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

  // Track last assistant text for quick response detection
  let lastAssistantText = '';
  for (let fi = visibleEvents.length - 1; fi >= 0; fi--) {
    const ev = visibleEvents[fi].event;
    if (ev.type === 'assistant') {
      const ae = ev as AssistantEvent;
      for (let ci = ae.message.content.length - 1; ci >= 0; ci--) {
        const block = ae.message.content[ci];
        if (block.type === 'text' && (block as TextBlock).text.trim()) {
          lastAssistantText = (block as TextBlock).text;
          break;
        }
      }
      if (lastAssistantText) break;
    }
  }

  const showQuickResponse = !!onSendInput && !!lastAssistantText && !pendingApprovals.length;

  if (showQuickResponse) {
    items.push(
      <QuickResponseButtons
        key="quick-response"
        text={lastAssistantText}
        onSendInput={onSendInput!}
      />
    );
  }

  const hasHistory = sessionEvents.some(f => f.seq <= viewStartSeq);
  const hasPendingApprovals = pendingApprovals.length > 0;
  const showInputBar = sessionRunning && !!activeSessionId && !!onSendInput;

  const handleCopyAll = async () => {
    try {
      const md = exportTranscriptMarkdown(visibleEvents, activeSessionId ?? 'unknown');
      await Clipboard.setStringAsync(md);
    } catch { /* clipboard unavailable */ }
  };

  const handleShareAll = async () => {
    try {
      const md = exportTranscriptMarkdown(visibleEvents, activeSessionId ?? 'unknown');
      await Share.share({ message: md });
    } catch { /* user cancelled share sheet */ }
  };

  const handleAttach = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: true });
      if (result.canceled || !result.assets) return;
      const newFiles: AttachedFile[] = result.assets.map((a: DocumentPicker.DocumentPickerAsset) => ({ name: a.name, size: a.size ?? 0, uri: a.uri }));
      setAttachedFiles((prev: AttachedFile[]) => [...prev, ...newFiles].slice(0, 5));
    } catch { /* user cancelled picker */ }
  };

  const handleSendInput = () => {
    const text = inputText.trim();
    if ((!text && attachedFiles.length === 0) || !onSendInput) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const fileRefs = attachedFiles.map((f: AttachedFile) => `@${f.name}`).join(' ');
    const fullText = fileRefs ? `${text} ${fileRefs}`.trim() : text;
    onSendInput(fullText);
    setInputText('');
    setAttachedFiles([]);
  };

  const handleCompact = () => {
    if (!onSendInput) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSendInput('/compact');
  };

  const inputBar = showInputBar ? (
    <View>
      {attachedFiles.length > 0 && (
        <View style={styles.fileChipsRow}>
          {attachedFiles.map((f: AttachedFile, i: number) => (
            <FileChip
              key={`${f.name}-${i}`}
              name={f.name}
              size={f.size}
              onRemove={() => setAttachedFiles((prev: AttachedFile[]) => prev.filter((_: AttachedFile, idx: number) => idx !== i))}
            />
          ))}
        </View>
      )}
      <View style={styles.inputBar}>
        <Pressable style={styles.attachBtn} onPress={handleAttach} hitSlop={8}>
          <Text style={styles.attachBtnText}>+</Text>
        </Pressable>
        <TextInput
          style={[styles.inputField, hasPendingApprovals && styles.inputFieldDisabled]}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message…"
          placeholderTextColor="#52525b"
          autoCorrect={false}
          editable={!hasPendingApprovals}
          multiline
          blurOnSubmit={false}
        />
        <Pressable
          style={[styles.sendBtn, (!inputText.trim() && attachedFiles.length === 0 || hasPendingApprovals) && styles.sendBtnDisabled]}
          onPress={handleSendInput}
          disabled={(!inputText.trim() && attachedFiles.length === 0) || hasPendingApprovals}
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </Pressable>
      </View>
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
      {onBatchDecide && (
        <BatchApprovalBar
          pendingApprovals={pendingApprovals}
          onBatchDecide={onBatchDecide}
        />
      )}
      <ScrollView
        ref={scrollRef}
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={onRefresh ? <RefreshControl refreshing={false} onRefresh={onRefresh} tintColor="#4ade80" /> : undefined}
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
      {visibleEvents.length > 0 && (
        <View style={styles.sessionActions}>
          <Pressable onPress={handleCopyAll} style={styles.sessionBtn}>
            <Text style={styles.sessionBtnText}>Copy All</Text>
          </Pressable>
          <Pressable onPress={handleShareAll} style={styles.sessionBtn}>
            <Text style={styles.sessionBtnText}>Share</Text>
          </Pressable>
          {sessionRunning && onSendInput && (
            <Pressable onPress={handleCompact} style={[styles.sessionBtn, styles.compactBtn]}>
              <Text style={styles.compactBtnText}>Compact</Text>
            </Pressable>
          )}
        </View>
      )}
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
    alignItems: 'flex-end',
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
    paddingVertical: 10,
    color: '#f0f0f0',
    fontSize: 14,
    minHeight: 44,
    maxHeight: 120,
    textAlignVertical: 'top',
  },
  inputFieldDisabled: {
    opacity: 0.4,
  },
  sendBtn: {
    backgroundColor: '#1e3a5f',
    borderRadius: 8,
    paddingHorizontal: 16,
    minHeight: 44,
    minWidth: 44,
    justifyContent: 'center',
    alignItems: 'center',
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
  sessionActions: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e1e1e',
    backgroundColor: '#0a0a0a',
  },
  sessionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  sessionBtnText: { color: '#9ca3af', fontSize: 12, fontWeight: '600' },
  compactBtn: { borderColor: '#1e3a5f' },
  compactBtnText: { color: '#93c5fd', fontSize: 12, fontWeight: '600' },
  historyToggle: { alignItems: 'center', paddingVertical: 6 },
  historyToggleText: { color: '#52525b', fontSize: 11 },
  fileChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#1e1e1e',
    backgroundColor: '#0a0a0a',
  },
  attachBtn: {
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#0d0d0d',
  },
  attachBtnText: { color: '#9ca3af', fontSize: 20, fontWeight: '300' },
});
