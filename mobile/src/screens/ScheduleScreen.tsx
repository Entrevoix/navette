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
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Scheduled Sessions</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>

        {/* New schedule form */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>New Schedule</Text>
          <TextInput
            style={styles.promptInput}
            value={prompt}
            onChangeText={setPrompt}
            placeholder="What should Claude do?"
            placeholderTextColor="#444"
            multiline
            autoCorrect={false}
          />

          <Text style={styles.subLabel}>Run in...</Text>
          <View style={styles.quickRow}>
            {QUICK_HOURS.map(h => (
              <Pressable
                key={h}
                style={[styles.quickPill, selectedHours === h && styles.quickPillActive]}
                onPress={() => handleQuickSelect(h)}
              >
                <Text style={[styles.quickPillText, selectedHours === h && styles.quickPillTextActive]}>
                  {h}h
                </Text>
              </Pressable>
            ))}
            <TextInput
              style={[styles.customInput, selectedHours === null && customHours.length > 0 && styles.customInputActive]}
              value={customHours}
              onChangeText={handleCustomChange}
              placeholder="custom h"
              placeholderTextColor="#444"
              keyboardType="decimal-pad"
            />
          </View>

          {effectiveHours != null && !isNaN(effectiveHours) && effectiveHours > 0 && (
            <Text style={styles.previewText}>
              Fires at: {formatTime(Date.now() / 1000 + effectiveHours * 3600)}
            </Text>
          )}

          <Pressable
            style={[styles.scheduleBtn, !canSubmit && styles.scheduleBtnDisabled]}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            <Text style={styles.scheduleBtnText}>Schedule</Text>
          </Pressable>
        </View>

        {/* Pending list */}
        {pendingSessions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Pending ({pendingSessions.length})</Text>
            <FlatList
              data={pendingSessions}
              keyExtractor={s => s.id}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.jobRow}>
                  <View style={styles.jobInfo}>
                    <Text style={styles.jobPrompt} numberOfLines={2}>{item.prompt}</Text>
                    <Text style={styles.jobTime}>
                      {formatTime(item.scheduled_at)} · {formatRelative(item.scheduled_at)}
                    </Text>
                  </View>
                  <Pressable style={styles.cancelBtn} onPress={() => onCancel(item.id)}>
                    <Text style={styles.cancelBtnText}>Cancel</Text>
                  </Pressable>
                </View>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </View>
        )}

        {/* Fired list */}
        {firedSessions.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Fired ({firedSessions.length})</Text>
            <FlatList
              data={firedSessions}
              keyExtractor={s => s.id}
              scrollEnabled={false}
              renderItem={({ item }) => (
                <View style={styles.jobRow}>
                  <View style={styles.jobInfo}>
                    <Text style={[styles.jobPrompt, styles.jobPromptFired]} numberOfLines={2}>{item.prompt}</Text>
                    <Text style={styles.jobTime}>{formatTime(item.scheduled_at)}</Text>
                  </View>
                  <View style={styles.firedBadge}>
                    <Text style={styles.firedBadgeText}>fired</Text>
                  </View>
                </View>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          </View>
        )}

        {scheduledSessions.length === 0 && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No scheduled sessions yet.</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
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
  title: { color: '#f0f0f0', fontSize: 18, fontWeight: '700' },
  closeBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  closeText: { color: '#4ade80', fontSize: 15, fontWeight: '600' },

  section: { padding: 20, gap: 12 },
  sectionLabel: {
    color: '#888',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  subLabel: { color: '#555', fontSize: 12, fontWeight: '600' },

  promptInput: {
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 12,
    color: '#f0f0f0',
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
    borderColor: '#2a2a2a',
    backgroundColor: '#0d0d0d',
  },
  quickPillActive: { borderColor: '#4ade80', backgroundColor: '#14280f' },
  quickPillText: { color: '#71717a', fontSize: 13, fontWeight: '600' },
  quickPillTextActive: { color: '#4ade80' },
  customInput: {
    flex: 1,
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 8,
    color: '#f0f0f0',
    fontSize: 13,
    textAlign: 'center',
  },
  customInputActive: { borderColor: '#4ade80' },

  previewText: { color: '#6b7280', fontSize: 12 },

  scheduleBtn: {
    backgroundColor: '#14280f',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4ade80',
    marginTop: 4,
  },
  scheduleBtnDisabled: { opacity: 0.35 },
  scheduleBtnText: { color: '#4ade80', fontSize: 15, fontWeight: '700' },

  jobRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
  },
  jobInfo: { flex: 1 },
  jobPrompt: { color: '#e2e8f0', fontSize: 13, fontWeight: '500', marginBottom: 3 },
  jobPromptFired: { color: '#52525b' },
  jobTime: { color: '#6b7280', fontSize: 11 },

  cancelBtn: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    backgroundColor: '#1c0a0a',
  },
  cancelBtnText: { color: '#f87171', fontSize: 12, fontWeight: '600' },

  firedBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#1a1a1a',
  },
  firedBadgeText: { color: '#52525b', fontSize: 11, fontWeight: '600' },

  separator: { height: 1, backgroundColor: '#1a1a1a' },

  emptyState: { padding: 32, alignItems: 'center' },
  emptyText: { color: '#3f3f46', fontSize: 14 },
});
