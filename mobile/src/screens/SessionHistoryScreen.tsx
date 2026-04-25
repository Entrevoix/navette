// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, useTheme } from 'react-native-paper';
import { EventLog } from '../components/EventLog';
import { EventFrame, PastSessionInfo, SearchResult } from '../types';

interface SessionHistoryScreenProps {
  visible: boolean;
  onClose: () => void;
  pastSessions: PastSessionInfo[];
  sessionHistory: Record<string, EventFrame[]>;
  searchResults: SearchResult[];
  onListPastSessions: () => void;
  onGetSessionHistory: (sessionId: string) => void;
  onSearchSessions: (query: string) => void;
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
  searchResults,
  onListPastSessions,
  onGetSessionHistory,
  onSearchSessions,
}: SessionHistoryScreenProps) {
  const theme = useTheme();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isSearching = searchQuery.trim().length > 0;
  const displaySessions: PastSessionInfo[] = isSearching
    ? searchResults.map(r => ({ session_id: r.session_id, event_count: r.event_count, started_at: r.started_at, last_event: r.last_event }))
    : pastSessions;

  const handleSearchChange = useCallback((text: string) => {
    setSearchQuery(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (text.trim()) {
      debounceRef.current = setTimeout(() => onSearchSessions(text.trim()), 300);
    }
  }, [onSearchSessions]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  const handleOpen = () => {
    onListPastSessions();
    setSelectedId(null);
    setSearchQuery('');
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
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>Session History</Text>
          <Button mode="text" onPress={onClose}>Done</Button>
        </View>

        <View style={styles.body}>
          {/* Session list panel */}
          <View style={[styles.listPanel, { borderBottomColor: theme.colors.outlineVariant }]}>
            <TextInput
              style={[styles.searchInput, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
              value={searchQuery}
              onChangeText={handleSearchChange}
              placeholder="Search sessions..."
              placeholderTextColor={theme.colors.onSurfaceVariant}
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
            />
            <Text style={[styles.panelLabel, { color: theme.colors.onSurfaceVariant, borderBottomColor: theme.colors.outlineVariant }]}>
              {isSearching
                ? `Results (${displaySessions.length})`
                : `Past Sessions (${pastSessions.length})`}
            </Text>
            {displaySessions.length === 0 ? (
              <View style={styles.emptyPanel}>
                <Text style={[styles.emptyPanelText, { color: theme.colors.onSurfaceVariant }]}>
                  {isSearching ? 'No matching sessions' : 'No past sessions found'}
                </Text>
              </View>
            ) : (
              <FlatList
                data={displaySessions}
                keyExtractor={item => item.session_id}
                renderItem={({ item }) => {
                  const isSelected = item.session_id === selectedId;
                  return (
                    <Pressable
                      style={[styles.sessionRow, { borderBottomColor: theme.colors.outlineVariant }, isSelected && { backgroundColor: theme.colors.primaryContainer, borderLeftColor: theme.colors.primary }]}
                      onPress={() => handleSelectSession(item.session_id)}
                    >
                      <Text style={[styles.sessionId, { color: theme.colors.primary }, isSelected && { color: theme.colors.onPrimaryContainer }]}>
                        {item.session_id.slice(0, 12)}
                      </Text>
                      <Text style={[styles.sessionDate, { color: theme.colors.onSurfaceVariant }]}>{formatDate(item.started_at)}</Text>
                      <Text style={[styles.sessionCount, { color: theme.colors.onSurfaceVariant }]}>{item.event_count} events</Text>
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
                <Text style={[styles.panelLabel, { color: theme.colors.onSurfaceVariant, borderBottomColor: theme.colors.outlineVariant }]}>
                  {selectedId.slice(0, 12)} · {formatDate(
                    pastSessions.find(s => s.session_id === selectedId)?.started_at ?? 0
                  )}
                </Text>
                <EventLog events={selectedEvents} />
              </>
            ) : (
              <View style={styles.emptyPanel}>
                <Text style={[styles.emptyPanelText, { color: theme.colors.onSurfaceVariant }]}>Select a session to view events</Text>
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
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
  },
  body: {
    flex: 1,
    flexDirection: 'column',
  },
  searchInput: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
    marginHorizontal: 16,
    marginTop: 10,
    fontSize: 13,
  },
  listPanel: {
    borderBottomWidth: 1,
    maxHeight: '40%',
  },
  detailPanel: {
    flex: 1,
  },
  panelLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  emptyPanel: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  emptyPanelText: {
    fontSize: 13,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderLeftWidth: 2,
    borderLeftColor: 'transparent',
    gap: 8,
  },
  sessionId: {
    fontSize: 12,
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    flex: 1,
  },
  sessionDate: {
    fontSize: 11,
  },
  sessionCount: {
    fontSize: 11,
    minWidth: 60,
    textAlign: 'right',
  },
});
