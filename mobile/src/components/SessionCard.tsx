import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SessionInfo } from '../types';

export interface SessionCardProps {
  session: SessionInfo;
  isActive: boolean;
  onSelect: (id: string) => void;
  hasPendingApproval?: boolean;
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

function statusDotColor(hasPendingApproval: boolean, isActive: boolean): string {
  if (hasPendingApproval) return '#fbbf24'; // yellow — waiting approval
  if (isActive) return '#4ade80';           // green — running
  return '#6b7280';                          // gray — idle/done
}

export function SessionCard({ session, isActive, onSelect, hasPendingApproval = false }: SessionCardProps) {
  const [elapsed, setElapsed] = useState(() =>
    Math.floor((Date.now() - session.started_at * 1000) / 1000)
  );

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - session.started_at * 1000) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [session.started_at]);

  const agentLabel = detectAgent(session);
  const promptPreview = session.prompt.length > 60
    ? session.prompt.slice(0, 60) + '…'
    : session.prompt;
  const dotColor = statusDotColor(hasPendingApproval, isActive);

  const inputTok = session.input_tokens ?? 0;
  const outputTok = session.output_tokens ?? 0;
  const showTokens = inputTok > 0 || outputTok > 0;

  return (
    <Pressable
      style={[styles.card, isActive && styles.cardActive]}
      onPress={() => onSelect(session.session_id)}
    >
      <View style={styles.header}>
        <Text style={styles.agentLabel}>{agentLabel}</Text>
        <View style={[styles.statusDot, { backgroundColor: dotColor }]} />
      </View>

      <Text style={styles.prompt} numberOfLines={2}>
        {promptPreview}
      </Text>

      <View style={styles.footer}>
        {session.container ? (
          <Text style={styles.container} numberOfLines={1}>
            {session.container}
          </Text>
        ) : null}
        <Text style={styles.elapsed}>{formatElapsed(Math.max(0, elapsed))}</Text>
      </View>

      {showTokens ? (
        <Text style={styles.tokens}>
          {`\u2191${formatTokens(inputTok)} \u2193${formatTokens(outputTok)}`}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 180,
    backgroundColor: '#1e1e2e',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    marginRight: 10,
  },
  cardActive: {
    borderColor: '#4a9eff',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  agentLabel: {
    color: '#7b8cde',
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
    color: '#f0f0f0',
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
    color: '#6b7280',
    fontSize: 11,
    fontFamily: 'Menlo',
    flex: 1,
    marginRight: 6,
  },
  elapsed: {
    color: '#6b7280',
    fontSize: 11,
    fontFamily: 'Menlo',
  },
  tokens: {
    color: '#4b5563',
    fontSize: 10,
    fontFamily: 'Menlo',
    marginTop: 4,
  },
});
