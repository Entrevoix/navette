// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import { SessionInfo } from '../types';

export interface SessionCardProps {
  session: SessionInfo;
  isActive: boolean;
  onSelect: (id: string) => void;
  hasPendingApproval?: boolean;
  hasUnread?: boolean;
  unreadCount?: number;
}

const AGENT_LABELS: Record<string, string> = {
  codex: 'Codex',
  gemini: 'Gemini',
  aider: 'Aider',
  claude: 'Claude',
};

function detectAgent(session: SessionInfo): string {
  // command field not in SessionInfo type yet — check via cast
  const cmd = (session as SessionInfo & { command?: string }).command;
  if (cmd && AGENT_LABELS[cmd]) return AGENT_LABELS[cmd];
  return 'Claude';
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function SessionCard({ session, isActive, onSelect, hasPendingApproval = false, hasUnread = false, unreadCount = 0 }: SessionCardProps) {
  const theme = useTheme();
  const [elapsed, setElapsed] = useState(() =>
    Math.floor((Date.now() - session.started_at * 1000) / 1000)
  );
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - session.started_at * 1000) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [session.started_at]);

  useEffect(() => {
    if (hasUnread && !isActive) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 0.4, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      );
      loop.start();
      return () => loop.stop();
    }
    pulseAnim.setValue(1);
  }, [hasUnread, isActive, pulseAnim]);

  // Determine status dot color using theme tokens
  let dotColor = theme.colors.onSurfaceVariant;
  if (hasPendingApproval) dotColor = theme.colors.tertiary;
  else if (isActive) dotColor = theme.colors.primary;

  const agentLabel = detectAgent(session);
  const promptPreview = session.prompt.length > 60
    ? session.prompt.slice(0, 60) + '…'
    : session.prompt;
  const showBadge = hasUnread && !isActive;

  const inputTok = session.input_tokens ?? 0;
  const outputTok = session.output_tokens ?? 0;
  const showTokens = inputTok > 0 || outputTok > 0;

  return (
    <Pressable
      style={[
        styles.card,
        { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant },
        isActive && { borderColor: theme.colors.primary },
      ]}
      onPress={() => onSelect(session.session_id)}
    >
      {showBadge && (
        <Animated.View style={[styles.badge, { backgroundColor: theme.colors.error, opacity: pulseAnim }]}>
          <Text style={[styles.badgeText, { color: theme.colors.onError }]}>{unreadCount > 1 ? String(unreadCount) : ''}</Text>
        </Animated.View>
      )}
      <View style={styles.header}>
        <Text style={[styles.agentLabel, { color: theme.colors.primary }]}>{agentLabel}</Text>
        <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
      </View>

      <Text style={[styles.prompt, { color: theme.colors.onSurface }]} numberOfLines={2}>
        {promptPreview}
      </Text>

      <View style={styles.footer}>
        {session.container ? (
          <Text style={[styles.container, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
            {session.container}
          </Text>
        ) : null}
        <Text style={[styles.elapsed, { color: theme.colors.onSurfaceVariant }]}>{formatElapsed(Math.max(0, elapsed))}</Text>
      </View>

      {showTokens ? (
        <Text style={[styles.tokens, { color: theme.colors.onSurfaceVariant }]}>
          {`↑${formatTokens(inputTok)} ↓${formatTokens(outputTok)}`}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 180,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    marginRight: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  agentLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  prompt: {
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 8,
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  container: {
    fontSize: 11,
    fontFamily: 'Menlo',
    flex: 1,
    marginRight: 6,
  },
  elapsed: {
    fontSize: 11,
    fontFamily: 'Menlo',
  },
  tokens: {
    fontSize: 10,
    fontFamily: 'Menlo',
    marginTop: 4,
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    borderRadius: 9,
    minWidth: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    paddingHorizontal: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
});
