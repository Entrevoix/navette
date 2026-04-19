import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { EventFrame, PastSessionInfo } from '../types';

interface SessionHistoryScreenProps {
  visible: boolean;
  onClose: () => void;
  pastSessions: PastSessionInfo[];
  sessionHistory: Record<string, EventFrame[]>;
  onListPastSessions: () => void;
  onGetSessionHistory: (sessionId: string) => void;
}

function formatDate(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function HistoryEventList({ events }: { events: EventFrame[] }) {
  if (events.length === 0) {
    return (
      <View style={evStyles.empty}>
        <Text style={evStyles.emptyText}>Loading events…</Text>
      </View>
    );
  }

  const items: React.ReactNode[] = [];

  for (const frame of events) {
    const ev = frame.event as { type: string; [key: string]: unknown };

    if (ev.type === 'session_started') {
      const prompt = ev.prompt as string | undefined;
      items.push(
        <View key={`ss-${frame.seq}`} style={evStyles.dividerRow}>
          <View style={evStyles.dividerLine} />
          <Text style={evStyles.dividerLabel}>session</Text>
          <View style={evStyles.dividerLine} />
        </View>
      );
      if (prompt) {
        items.push(
          <View key={`up-${frame.seq}`} style={evStyles.userBubble}>
            <Text selectable style={evStyles.userText}>{prompt}</Text>
          </View>
        );
      }
      continue;
    }

    if (ev.type === 'session_ended') {
      const ok = ev.ok as boolean | undefined;
      items.push(
        <View key={`se-${frame.seq}`} style={evStyles.dividerRow}>
          <View style={evStyles.dividerLine} />
          <Text style={[evStyles.dividerLabel, ok ? evStyles.doneLabel : evStyles.failLabel]}>
            {ok ? 'done' : 'failed'}
          </Text>
          <View style={evStyles.dividerLine} />
        </View>
      );
      continue;
    }

    if (ev.type === 'assistant') {
      const msg = ev.message as { content?: Array<{ type: string; text?: string }> } | undefined;
      const content = msg?.content ?? [];
      for (let i = 0; i < content.length; i++) {
        const block = content[i];
        if (block.type === 'text' && block.text?.trim()) {
          items.push(
            <Text key={`at-${frame.seq}-${i}`} selectable style={evStyles.assistantText}>
              {block.text}
            </Text>
          );
        } else if (block.type === 'tool_use') {
          const tb = block as { type: string; name?: string };
          items.push(
            <View key={`tc-${frame.seq}-${i}`} style={evStyles.toolRow}>
              <Text style={evStyles.toolCheck}>✓</Text>
              <Text style={evStyles.toolName}>{tb.name ?? 'tool'}</Text>
            </View>
          );
        }
      }
      continue;
    }

    if (ev.type === 'result') {
      const result = ev.result as string | undefined;
      if (result?.trim()) {
        items.push(
          <Text key={`r-${frame.seq}`} selectable style={evStyles.resultText}>
            {result.length > 500 ? result.slice(0, 500) + '…' : result}
          </Text>
        );
      }
    }
  }

  return (
    <ScrollView style={evStyles.scroll} contentContainerStyle={evStyles.content}>
      {items}
    </ScrollView>
  );
}

const evStyles = StyleSheet.create({
  scroll: { flex: 1 },
  content: { padding: 12, gap: 8 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  emptyText: { color: '#71717a', fontSize: 13 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#1e1e1e' },
  dividerLabel: { color: '#6b7280', fontSize: 10, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 },
  doneLabel: { color: '#4ade80' },
  failLabel: { color: '#f87171' },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: '#0f172a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1e3a5f',
    padding: 10,
    maxWidth: '88%',
  },
  userText: { color: '#93c5fd', fontSize: 13, lineHeight: 18 },
  assistantText: { color: '#d4d4d8', fontSize: 13, lineHeight: 20 },
  toolRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  toolCheck: { color: '#4ade80', fontSize: 11 },
  toolName: { color: '#93c5fd', fontSize: 12, fontWeight: '600', fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo' },
  resultText: { color: '#a3a3a3', fontSize: 12, lineHeight: 18, fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo' },
});

export function SessionHistoryScreen({
  visible,
  onClose,
  pastSessions,
  sessionHistory,
  onListPastSessions,
  onGetSessionHistory,
}: SessionHistoryScreenProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleOpen = () => {
    onListPastSessions();
    setSelectedId(null);
  };

  const handleSelectSession = (id: string) => {
    setSelectedId(id);
    if (!sessionHistory[id]) {
      onGetSessionHistory(id);
    }
  };

  const selectedEvents = selectedId ? (sessionHistory[selectedId] ?? []) : [];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
      onShow={handleOpen}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Session History</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.body}>
          {/* Session list panel */}
          <View style={styles.listPanel}>
            <Text style={styles.panelLabel}>Past Sessions ({pastSessions.length})</Text>
            {pastSessions.length === 0 ? (
              <View style={styles.emptyPanel}>
                <Text style={styles.emptyPanelText}>No past sessions found</Text>
              </View>
            ) : (
              <FlatList
                data={pastSessions}
                keyExtractor={item => item.session_id}
                renderItem={({ item }) => {
                  const isSelected = item.session_id === selectedId;
                  return (
                    <Pressable
                      style={[styles.sessionRow, isSelected && styles.sessionRowActive]}
                      onPress={() => handleSelectSession(item.session_id)}
                    >
                      <Text style={[styles.sessionId, isSelected && styles.sessionIdActive]}>
                        {item.session_id.slice(0, 12)}
                      </Text>
                      <Text style={styles.sessionDate}>{formatDate(item.started_at)}</Text>
                      <Text style={styles.sessionCount}>{item.event_count} events</Text>
                    </Pressable>
                  );
                }}
              />
            )}
          </View>

          {/* Event detail panel */}
          <View style={styles.detailPanel}>
            {selectedId ? (
              <>
                <Text style={styles.panelLabel}>
                  {selectedId.slice(0, 12)} · {formatDate(
                    pastSessions.find(s => s.session_id === selectedId)?.started_at ?? 0
                  )}
                </Text>
                <HistoryEventList events={selectedEvents} />
              </>
            ) : (
              <View style={styles.emptyPanel}>
                <Text style={styles.emptyPanelText}>Select a session to view events</Text>
              </View>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  title: {
    color: '#f0f0f0',
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  closeText: {
    color: '#4ade80',
    fontSize: 15,
    fontWeight: '600',
  },
  body: {
    flex: 1,
    flexDirection: 'column',
  },
  listPanel: {
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    maxHeight: '40%',
  },
  detailPanel: {
    flex: 1,
  },
  panelLabel: {
    color: '#888',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  emptyPanel: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyPanelText: {
    color: '#555',
    fontSize: 13,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
    gap: 8,
  },
  sessionRowActive: {
    backgroundColor: '#0d1a0d',
    borderLeftWidth: 2,
    borderLeftColor: '#4ade80',
  },
  sessionId: {
    color: '#93c5fd',
    fontSize: 12,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    flex: 1,
  },
  sessionIdActive: {
    color: '#4ade80',
  },
  sessionDate: {
    color: '#555',
    fontSize: 11,
  },
  sessionCount: {
    color: '#444',
    fontSize: 11,
    minWidth: 60,
    textAlign: 'right',
  },
});
