// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, useTheme } from 'react-native-paper';
import { ScheduledSessionInfo } from '../types';

interface ScheduleScreenProps {
  visible: boolean;
  onClose: () => void;
  scheduledSessions: ScheduledSessionInfo[];
  onSchedule: (prompt: string, scheduledAt: number) => void;
  onCancel: (id: string) => void;
  onRefresh: () => void;
}

function formatTime(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  return d.toLocaleString();
}

function formatRelative(unixSecs: number): string {
  const diffSecs = unixSecs - Date.now() / 1000;
  if (diffSecs <= 0) return 'now';
  const h = Math.floor(diffSecs / 3600);
  const m = Math.floor((diffSecs % 3600) / 60);
  if (h > 0) return `in ${h}h ${m}m`;
  return `in ${m}m`;
}

const QUICK_HOURS = [1, 4, 8, 24] as const;

export function ScheduleScreen({ visible, onClose, scheduledSessions, onSchedule, onCancel, onRefresh }: ScheduleScreenProps) {
  const theme = useTheme();
  const [prompt, setPrompt] = useState('');
  const [customHours, setCustomHours] = useState('');
  const [selectedHours, setSelectedHours] = useState<number | null>(null);

  useEffect(() => {
    if (visible) {
      onRefresh();
    }
  }, [visible, onRefresh]);

  const handleQuickSelect = (h: number) => {
    setSelectedHours(h);
    setCustomHours('');
  };

  const handleCustomChange = (v: string) => {
    setCustomHours(v);
    setSelectedHours(null);
  };

  const effectiveHours: number | null = selectedHours ?? (customHours ? parseFloat(customHours) : null);

  const handleSubmit = useCallback(() => {
    const p = prompt.trim();
    if (!p || effectiveHours == null || isNaN(effectiveHours) || effectiveHours <= 0) return;
    const scheduledAt = Date.now() / 1000 + effectiveHours * 3600;
    onSchedule(p, scheduledAt);
    setPrompt('');
    setCustomHours('');
    setSelectedHours(null);
  }, [prompt, effectiveHours, onSchedule]);

  const pendingSessions = scheduledSessions.filter(s => !s.fired);
  const firedSessions = scheduledSessions.filter(s => s.fired);

  const canSubmit = prompt.trim().length > 0 && effectiveHours != null && !isNaN(effectiveHours) && effectiveHours > 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>Scheduled Sessions</Text>
          <Button mode="text" onPress={onClose}>Done</Button>
        </View>

        {/* New schedule form */}
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>New Schedule</Text>
          <TextInput
            style={[styles.promptInput, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="What should Claude do?"
            placeholderTextColor={theme.colors.onSurfaceVariant}
            multiline
            autoCorrect={false}
          />

          <Text style={[styles.subLabel, { color: theme.colors.onSurfaceVariant }]}>Run in...</Text>
          <View style={styles.quickRow}>
            {QUICK_HOURS.map(h => (
              <Pressable
                key={h}
                style={[styles.quickPill, { borderColor: theme.colors.outlineVariant, backgroundColor: theme.colors.surfaceVariant }, selectedHours === h && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryContainer }]}
                onPress={() => handleQuickSelect(h)}
              >
                <Text style={[styles.quickPillText, { color: theme.colors.onSurfaceVariant }, selectedHours === h && { color: theme.colors.primary }]}>
                  {h}h
                </Text>
              </Pressable>
            ))}
            <TextInput
              style={[styles.customInput, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }, selectedHours === null && customHours.length > 0 && { borderColor: theme.colors.primary }]}
              value={customHours}
              onChangeText={handleCustomChange}
              placeholder="custom h"
              placeholderTextColor={theme.colors.onSurfaceVariant}
              keyboardType="decimal-pad"
            />
          </View>

          {effectiveHours != null && !isNaN(effectiveHours) && effectiveHours > 0 && (
            <Text style={[styles.previewText, { color: theme.colors.onSurfaceVariant }]}>
              Fires at: {formatTime(Date.now() / 1000 + effectiveHours * 3600)}
            </Text>
          )}

          <Button
            mode="contained-tonal"
            onPress={handleSubmit}
            disabled={!canSubmit}
            style={styles.scheduleBtn}
          >
            Schedule
          </Button>
        </View>

        {/* Pending list */}
        {pendingSessions.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Pending ({pendingSessions.length})</Text>
            <FlatList
              data={pendingSessions}
              keyExtractor={s => s.id}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.jobRow}>
                  <View style={styles.jobInfo}>
                    <Text style={[styles.jobPrompt, { color: theme.colors.onSurface }]} numberOfLines={2}>{item.prompt}</Text>
                    <Text style={[styles.jobTime, { color: theme.colors.onSurfaceVariant }]}>
                      {formatTime(item.scheduled_at)} · {formatRelative(item.scheduled_at)}
                    </Text>
                  </View>
                  <Button mode="outlined" compact onPress={() => onCancel(item.id)} textColor={theme.colors.error} style={{ borderColor: theme.colors.error }}>Cancel</Button>
                </View>
              )}
              ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.colors.outlineVariant }]} />}
            />
          </View>
        )}

        {/* Fired list */}
        {firedSessions.length > 0 && (
          <View style={styles.section}>
            <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Fired ({firedSessions.length})</Text>
            <FlatList
              data={firedSessions}
              keyExtractor={s => s.id}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.jobRow}>
                  <View style={styles.jobInfo}>
                    <Text style={[styles.jobPrompt, { color: theme.colors.onSurfaceVariant }]} numberOfLines={2}>{item.prompt}</Text>
                    <Text style={[styles.jobTime, { color: theme.colors.onSurfaceVariant }]}>{formatTime(item.scheduled_at)}</Text>
                  </View>
                  <View style={[styles.firedBadge, { backgroundColor: theme.colors.surfaceVariant }]}>
                    <Text style={[styles.firedBadgeText, { color: theme.colors.onSurfaceVariant }]}>fired</Text>
                  </View>
                </View>
              )}
              ItemSeparatorComponent={() => <View style={[styles.separator, { backgroundColor: theme.colors.outlineVariant }]} />}
            />
          </View>
        )}

        {scheduledSessions.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>No scheduled sessions yet.</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
  },
  title: { fontSize: 18, fontWeight: '700' },

  section: { padding: 20, gap: 12 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  subLabel: { fontSize: 12, fontWeight: '600' },

  promptInput: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    fontSize: 14,
    minHeight: 64,
    textAlignVertical: 'top',
  },

  quickRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  quickPill: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  quickPillText: { fontSize: 13, fontWeight: '600' },
  customInput: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    padding: 8,
    fontSize: 13,
    textAlign: 'center',
  },

  previewText: { fontSize: 12 },

  scheduleBtn: { marginTop: 4 },

  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  jobInfo: { flex: 1 },
  jobPrompt: { fontSize: 13, fontWeight: '500', marginBottom: 3 },
  jobTime: { fontSize: 11 },

  firedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  firedBadgeText: { fontSize: 11, fontWeight: '600' },

  separator: { height: 1 },

  emptyState: { padding: 32, alignItems: 'center' },
  emptyText: { fontSize: 14 },
});
