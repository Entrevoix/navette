import React, { useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { EventLog } from '../components/EventLog';
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
                <EventLog events={selectedEvents} />
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
