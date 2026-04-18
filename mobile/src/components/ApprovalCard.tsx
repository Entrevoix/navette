import React, { useCallback } from 'react';
import { Dimensions, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
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

function formatInput(input: Record<string, unknown>): string {
  const entries = Object.entries(input);
  if (entries.length === 0) return '(no input)';
  const first = entries[0];
  const value = typeof first[1] === 'string' ? first[1] : JSON.stringify(first[1]);
  const preview = value.slice(0, 200);
  return entries.length === 1 ? preview : `${preview}\n…+${entries.length - 1} more`;
}

export function ApprovalCard({ approval, onDecide }: ApprovalCardProps) {
  const translateX = useSharedValue(0);
  const opacity = useSharedValue(1);

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
    opacity: opacity.value,
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
            <Text style={styles.seqLabel}>#{approval.seq}</Text>
          </View>

          <Text style={styles.inputText} numberOfLines={8}>
            {formatInput(approval.tool_input)}
          </Text>

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
  seqLabel: {
    color: '#555',
    fontSize: 12,
  },
  inputText: {
    color: '#d0d0d0',
    fontFamily: Platform.OS === 'android' ? 'monospace' : 'Menlo',
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
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
    fontSize: 14,
  },
  denyText: {
    color: '#888',
    fontWeight: '600',
    fontSize: 14,
  },
  swipeHint: {
    textAlign: 'center',
    color: '#3a3a3a',
    fontSize: 11,
  },
});
