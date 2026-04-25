// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useState } from 'react';
import { Dimensions, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTheme } from 'react-native-paper';
import { PendingApproval } from '../types';
import { toolInputToDiff } from '../utils/diff';
import { DiffView } from './DiffView';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.35;

interface ApprovalCardProps {
  approval: PendingApproval;
  onDecide: (tool_use_id: string, allow: boolean) => void;
}

interface RenderedField {
  label: string;
  value: string;
  isPrimary?: boolean;
  isCode?: boolean;
}

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookRead', 'NotebookEdit']);

function renderFields(toolName: string, input: Record<string, unknown>): RenderedField[] {
  if (toolName === 'Bash') {
    const cmd = typeof input.command === 'string' ? input.command : JSON.stringify(input.command);
    const fields: RenderedField[] = [{ label: 'command', value: cmd, isPrimary: true, isCode: true }];
    if (input.description) fields.push({ label: 'description', value: String(input.description) });
    if (input.timeout != null) fields.push({ label: 'timeout', value: String(input.timeout) + 'ms' });
    return fields;
  }

  if (FILE_TOOLS.has(toolName)) {
    const fp = typeof input.file_path === 'string' ? input.file_path : '';
    const fields: RenderedField[] = [{ label: 'file', value: fp, isPrimary: true, isCode: true }];
    const body = input.content ?? input.new_string;
    if (body != null) {
      fields.push({
        label: 'content',
        value: typeof body === 'string' ? body : JSON.stringify(body, null, 2),
        isCode: true,
      });
    }
    if (input.old_string != null) {
      fields.push({ label: 'old', value: String(input.old_string), isCode: true });
    }
    return fields;
  }

  if (toolName === 'Glob') {
    const fields: RenderedField[] = [];
    if (input.pattern) fields.push({ label: 'pattern', value: String(input.pattern), isPrimary: true, isCode: true });
    if (input.path) fields.push({ label: 'path', value: String(input.path), isCode: true });
    return fields;
  }

  if (toolName === 'Grep') {
    const fields: RenderedField[] = [];
    if (input.pattern) fields.push({ label: 'pattern', value: String(input.pattern), isPrimary: true, isCode: true });
    if (input.path) fields.push({ label: 'path', value: String(input.path), isCode: true });
    if (input.glob) fields.push({ label: 'glob', value: String(input.glob), isCode: true });
    return fields;
  }

  return Object.entries(input).map(([key, val]) => ({
    label: key,
    value: typeof val === 'string' ? val : JSON.stringify(val, null, 2),
    isCode: true,
  }));
}

export function ApprovalCard({ approval, onDecide }: ApprovalCardProps) {
  const theme = useTheme();
  const translateX = useSharedValue(0);
  const [expanded, setExpanded] = useState(false);
  const fields = renderFields(approval.tool_name, approval.tool_input);
  const diffLines = toolInputToDiff(approval.tool_name, approval.tool_input);

  const [secsRemaining, setSecsRemaining] = useState<number | null>(
    approval.expires_at != null
      ? Math.max(0, Math.round(approval.expires_at - Date.now() / 1000))
      : null
  );

  useEffect(() => {
    if (approval.expires_at == null) return;
    const tick = () => {
      setSecsRemaining(Math.max(0, Math.round(approval.expires_at! - Date.now() / 1000)));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [approval.expires_at]);

  const isUrgent = approval.urgent === true || (secsRemaining !== null && secsRemaining <= 30);
  const borderOpacity = useSharedValue(1);

  useEffect(() => {
    if (isUrgent) {
      borderOpacity.value = withRepeat(
        withSequence(
          withTiming(0.2, { duration: 600 }),
          withTiming(1, { duration: 600 })
        ),
        -1,
        false
      );
    } else {
      borderOpacity.value = withTiming(1, { duration: 200 });
    }
  }, [isUrgent, borderOpacity]);

  const urgentBorderStyle = useAnimatedStyle(() => ({
    borderColor: isUrgent
      ? `rgba(249, 115, 22, ${borderOpacity.value})`
      : theme.colors.outlineVariant,
  }));

  const dismiss = useCallback((allow: boolean) => {
    if (allow) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } else {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
    onDecide(approval.tool_use_id, allow);
  }, [approval.tool_use_id, onDecide]);

  const panGesture = Gesture.Pan()
    .onUpdate((e: { translationX: number }) => {
      translateX.value = e.translationX;
    })
    .onEnd((e: { translationX: number }) => {
      if (e.translationX > SWIPE_THRESHOLD) {
        translateX.value = withSpring(SCREEN_WIDTH, {}, () => {
          runOnJS(dismiss)(true);
        });
      } else if (e.translationX < -SWIPE_THRESHOLD) {
        translateX.value = withSpring(-SCREEN_WIDTH, {}, () => {
          runOnJS(dismiss)(false);
        });
      } else {
        translateX.value = withSpring(0);
      }
    });

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const allowOpacity = useAnimatedStyle(() => ({
    opacity: Math.max(0, translateX.value / SWIPE_THRESHOLD),
  }));

  const denyOpacity = useAnimatedStyle(() => ({
    opacity: Math.max(0, -translateX.value / SWIPE_THRESHOLD),
  }));

  const primaryField = fields.find(f => f.isPrimary);
  const secondaryFields = fields.filter(f => !f.isPrimary);

  return (
    <View style={styles.wrapper}>
      <Animated.View style={[styles.hint, styles.hintAllow, { backgroundColor: theme.colors.primaryContainer }, allowOpacity]}>
        <Text style={[styles.hintText, { color: theme.colors.primary }]}>ALLOW</Text>
      </Animated.View>
      <Animated.View style={[styles.hint, styles.hintDeny, { backgroundColor: theme.colors.errorContainer }, denyOpacity]}>
        <Text style={[styles.hintText, { color: theme.colors.error }]}>DENY</Text>
      </Animated.View>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.card, { backgroundColor: theme.colors.surface }, animatedStyle, urgentBorderStyle]}>
          <View style={styles.header}>
            <View style={[styles.toolBadge, { backgroundColor: theme.colors.primaryContainer }]}>
              <Text style={[styles.toolName, { color: theme.colors.primary }]}>{approval.tool_name}</Text>
            </View>
            <View style={styles.headerRight}>
              {secsRemaining !== null && (
                <Text style={[styles.countdown, { color: theme.colors.onSurfaceVariant }, secsRemaining <= 30 && { color: theme.colors.error }]}>
                  {secsRemaining}s
                </Text>
              )}
              <Text style={[styles.seqLabel, { color: theme.colors.onSurfaceVariant }]}>#{approval.seq}</Text>
            </View>
          </View>

          {primaryField && (
            <View style={[styles.primaryField, { backgroundColor: theme.colors.background, borderColor: theme.colors.outlineVariant }]}>
              <Text style={[styles.primaryLabel, { color: theme.colors.onSurfaceVariant }]}>{primaryField.label}</Text>
              <Text selectable style={[styles.primaryValue, { color: theme.colors.onSurface }]} numberOfLines={expanded ? undefined : 4}>
                {primaryField.value}
              </Text>
            </View>
          )}

          {diffLines && <DiffView lines={diffLines} />}

          {secondaryFields.length > 0 && !diffLines && (
            <Pressable onPress={() => setExpanded(x => !x)} style={styles.inputArea}>
              <ScrollView
                style={[styles.inputScroll, { backgroundColor: theme.colors.background, borderColor: theme.colors.outlineVariant }, expanded ? styles.inputScrollExpanded : styles.inputScrollCollapsed]}
                scrollEnabled={expanded}
                showsVerticalScrollIndicator={expanded}
                nestedScrollEnabled
              >
                {secondaryFields.map(({ label, value, isCode }, idx) => (
                  <View key={`${label}-${idx}`} style={styles.field}>
                    <Text style={[styles.fieldLabel, { color: theme.colors.onSurfaceVariant }]}>{label}</Text>
                    <Text selectable style={[styles.fieldValue, { color: theme.colors.onSurface }, isCode && styles.fieldValueCode]}>{value}</Text>
                  </View>
                ))}
              </ScrollView>
              <Text style={[styles.expandHint, { color: theme.colors.onSurfaceVariant }]}>{expanded ? '▲ collapse' : '▼ more'}</Text>
            </Pressable>
          )}

          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.denyBtn, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]} onPress={() => dismiss(false)}>
              <Text style={[styles.denyText, { color: theme.colors.onSurfaceVariant }]}>Deny</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.allowBtn, { backgroundColor: theme.colors.primaryContainer }]} onPress={() => dismiss(true)}>
              <Text style={[styles.allowText, { color: theme.colors.primary }]}>Allow</Text>
            </Pressable>
          </View>

          <Text style={[styles.swipeHint, { color: theme.colors.onSurfaceVariant }]}>← swipe to deny · swipe to allow →</Text>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const MONO = Platform.OS === 'android' ? 'monospace' : 'Menlo';

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 16,
    marginBottom: 12,
    position: 'relative',
  },
  hint: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 80,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 14,
    zIndex: 0,
  },
  hintAllow: { right: 0 },
  hintDeny: { left: 0 },
  hintText: { fontWeight: '800', fontSize: 13, letterSpacing: 1 },
  card: {
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    zIndex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  toolBadge: {
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  toolName: { fontWeight: '700', fontSize: 13, letterSpacing: 0.3 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  countdown: { fontSize: 12, fontVariant: ['tabular-nums'] },
  seqLabel: { fontSize: 12 },

  primaryField: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 12,
    marginBottom: 10,
  },
  primaryLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 5,
  },
  primaryValue: {
    fontFamily: MONO,
    fontSize: 13,
    lineHeight: 20,
  },

  inputArea: { marginBottom: 14 },
  inputScroll: {
    borderRadius: 8,
    borderWidth: 1,
    padding: 10,
  },
  inputScrollCollapsed: { maxHeight: 100 },
  inputScrollExpanded: { maxHeight: 280 },
  field: { marginBottom: 10 },
  fieldLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  fieldValue: { fontSize: 12, lineHeight: 18 },
  fieldValueCode: { fontFamily: MONO },
  expandHint: { fontSize: 10, textAlign: 'right', marginTop: 4 },

  actions: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  btn: { flex: 1, paddingVertical: 13, borderRadius: 8, alignItems: 'center' },
  allowBtn: {},
  denyBtn: { borderWidth: 1 },
  allowText: { fontWeight: '700', fontSize: 15 },
  denyText: { fontWeight: '600', fontSize: 15 },
  swipeHint: { textAlign: 'center', fontSize: 11 },
});
