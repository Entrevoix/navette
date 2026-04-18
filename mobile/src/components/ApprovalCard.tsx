import React, { useCallback, useEffect, useState } from 'react';
import { Dimensions, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { PendingApproval } from '../types';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.35;

interface ApprovalCardProps {
  approval: PendingApproval;
  onDecide: (tool_use_id: string, allow: boolean) => void;
}

function formatInput(input: Record<string, unknown>): { label: string; value: string }[] {
  return Object.entries(input).map(([key, val]) => ({
    label: key,
    value: typeof val === 'string' ? val : JSON.stringify(val, null, 2),
  }));
}

export function ApprovalCard({ approval, onDecide }: ApprovalCardProps) {
  const translateX = useSharedValue(0);
  const [expanded, setExpanded] = useState(false);
  const fields = formatInput(approval.tool_input);

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

  const dismiss = useCallback((allow: boolean) => {
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

  return (
    <View style={styles.wrapper}>
      <Animated.View style={[styles.hint, styles.hintAllow, allowOpacity]}>
        <Text style={styles.hintText}>ALLOW</Text>
      </Animated.View>
      <Animated.View style={[styles.hint, styles.hintDeny, denyOpacity]}>
        <Text style={styles.hintText}>DENY</Text>
      </Animated.View>

      <GestureDetector gesture={panGesture}>
        <Animated.View style={[styles.card, animatedStyle]}>
          <View style={styles.header}>
            <View style={styles.toolBadge}>
              <Text style={styles.toolName}>{approval.tool_name}</Text>
            </View>
            <View style={styles.headerRight}>
              {secsRemaining !== null && (
                <Text style={[styles.countdown, secsRemaining <= 30 && styles.countdownWarn]}>
                  {secsRemaining}s
                </Text>
              )}
              <Text style={styles.seqLabel}>#{approval.seq}</Text>
            </View>
          </View>

          <Pressable onPress={() => setExpanded(x => !x)} style={styles.inputArea}>
            <ScrollView
              style={[styles.inputScroll, expanded ? styles.inputScrollExpanded : styles.inputScrollCollapsed]}
              scrollEnabled={expanded}
              showsVerticalScrollIndicator={expanded}
              nestedScrollEnabled
            >
              {fields.map(({ label, value }, idx) => (
                <View key={`${label}-${idx}`} style={styles.field}>
                  <Text style={styles.fieldLabel}>{label}</Text>
                  <Text selectable style={styles.fieldValue}>{value}</Text>
                </View>
              ))}
            </ScrollView>
            <Text style={styles.expandHint}>{expanded ? '▲ collapse' : '▼ tap to expand'}</Text>
          </Pressable>

          <View style={styles.actions}>
            <Pressable style={[styles.btn, styles.denyBtn]} onPress={() => dismiss(false)}>
              <Text style={styles.denyText}>Deny</Text>
            </Pressable>
            <Pressable style={[styles.btn, styles.allowBtn]} onPress={() => dismiss(true)}>
              <Text style={styles.allowText}>Allow</Text>
            </Pressable>
          </View>

          <Text style={styles.swipeHint}>← swipe to deny · swipe to allow →</Text>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

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
  hintAllow: {
    right: 0,
    backgroundColor: '#14532d',
  },
  hintDeny: {
    left: 0,
    backgroundColor: '#450a0a',
  },
  hintText: {
    fontWeight: '800',
    fontSize: 13,
    letterSpacing: 1,
    color: '#fff',
  },
  card: {
    backgroundColor: '#141414',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    zIndex: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  toolBadge: {
    backgroundColor: '#1e3a5f',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  toolName: {
    color: '#93c5fd',
    fontWeight: '700',
    fontSize: 13,
    letterSpacing: 0.3,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  countdown: {
    color: '#555',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  countdownWarn: {
    color: '#f97316',
  },
  seqLabel: {
    color: '#555',
    fontSize: 12,
  },
  inputArea: {
    marginBottom: 14,
  },
  inputScroll: {
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#222',
    padding: 10,
  },
  inputScrollCollapsed: {
    maxHeight: 140,
  },
  inputScrollExpanded: {
    maxHeight: 320,
  },
  field: {
    marginBottom: 10,
  },
  fieldLabel: {
    color: '#555',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  fieldValue: {
    color: '#d0d0d0',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    fontSize: 12,
    lineHeight: 18,
  },
  expandHint: {
    color: '#333',
    fontSize: 10,
    textAlign: 'right',
    marginTop: 4,
    marginRight: 4,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  btn: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 8,
    alignItems: 'center',
  },
  allowBtn: {
    backgroundColor: '#14532d',
  },
  denyBtn: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#3f3f3f',
  },
  allowText: {
    color: '#4ade80',
    fontWeight: '700',
    fontSize: 15,
  },
  denyText: {
    color: '#888',
    fontWeight: '600',
    fontSize: 15,
  },
  swipeHint: {
    textAlign: 'center',
    color: '#2e2e2e',
    fontSize: 11,
  },
});
