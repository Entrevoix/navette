import React, { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ChatView } from '../components/ChatView';
import { EventFeed } from '../components/EventFeed';
import { VoiceButton } from '../components/VoiceButton';
import { SettingsScreen } from './SettingsScreen';
import { ConnectionStatus, EventFrame, PendingApproval, SessionStatus } from '../types';
import type { NotifyConfig } from '../hooks/useClaudedWS';

interface MainScreenProps {
  status: ConnectionStatus;
  sessionStatus: SessionStatus;
  events: EventFrame[];
  pendingApprovals: PendingApproval[];
  lastSeq: number;
  defaultContainer?: string;
  notifyConfig: NotifyConfig | null;
  onDecide: (tool_use_id: string, allow: boolean) => void;
  onDisconnect: () => void;
  onRun: (prompt: string, container?: string, dangerouslySkipPermissions?: boolean) => void;
  onKill: () => void;
  onRequestNotifyConfig: () => void;
}

const STATUS_COLOR: Record<ConnectionStatus, string> = {
  disconnected: '#6b7280',
  connecting: '#fbbf24',
  authenticating: '#fbbf24',
  connected: '#4ade80',
  error: '#f87171',
};

function formatElapsed(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

export function MainScreen({
  status,
  sessionStatus,
  events,
  pendingApprovals,
  lastSeq,
  defaultContainer,
  notifyConfig,
  onDecide,
  onDisconnect,
  onRun,
  onKill,
  onRequestNotifyConfig,
}: MainScreenProps) {
  const [prompt, setPrompt] = useState('');
  const [isVoiceInterim, setIsVoiceInterim] = useState(false);
  const [container, setContainer] = useState(defaultContainer ?? '');
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(false);
  const [skipPermsConfirming, setSkipPermsConfirming] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [logExpanded, setLogExpanded] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (sessionStatus === 'running') {
      setElapsed(0);
      const id = setInterval(() => setElapsed(s => s + 1), 1000);
      timerRef.current = id;
      return () => {
        clearInterval(id);
        timerRef.current = null;
      };
    } else {
      setDangerouslySkipPermissions(false);
      setSkipPermsConfirming(false);
      if (confirmTimerRef.current !== null) {
        clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
    }
  }, [sessionStatus]);

  const handleSkipPermsToggle = () => {
    if (dangerouslySkipPermissions) {
      setDangerouslySkipPermissions(false);
      setSkipPermsConfirming(false);
      if (confirmTimerRef.current !== null) {
        clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
    } else if (skipPermsConfirming) {
      setSkipPermsConfirming(false);
      setDangerouslySkipPermissions(true);
      if (confirmTimerRef.current !== null) {
        clearTimeout(confirmTimerRef.current);
        confirmTimerRef.current = null;
      }
    } else {
      setSkipPermsConfirming(true);
      confirmTimerRef.current = setTimeout(() => {
        setSkipPermsConfirming(false);
        confirmTimerRef.current = null;
      }, 3000);
    }
  };

  const handleVoiceTranscript = (text: string, isFinal: boolean) => {
    setPrompt(text);
    setIsVoiceInterim(!isFinal);
  };

  const handleRun = () => {
    const p = prompt.trim();
    if (!p) return;
    onRun(p, container.trim() || undefined, dangerouslySkipPermissions);
    setPrompt('');
    setIsVoiceInterim(false);
  };

  const handleShareLog = async () => {
    if (events.length === 0) return;
    const text = events.map(e => JSON.stringify(e)).join('\n');
    await Share.share({ message: text });
  };

  const isRunning = sessionStatus === 'running';

  return (
    <View style={styles.container}>
      <SettingsScreen
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        notifyConfig={notifyConfig}
        onRequestNotifyConfig={onRequestNotifyConfig}
      />

      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR[status] }]} />
          <Text style={styles.statusText}>{status}</Text>
          {lastSeq > 0 && <Text style={styles.seqBadge}>seq {lastSeq}</Text>}
          {isRunning && (
            <View style={styles.sessionBadge}>
              <Text style={styles.sessionBadgeText}>running · {formatElapsed(elapsed)}</Text>
            </View>
          )}
        </View>
        <View style={styles.topBarActions}>
          <Pressable onPress={() => setSettingsVisible(true)} hitSlop={10} style={styles.gearBtn}>
            <Text style={styles.gearText}>⚙</Text>
          </Pressable>
          {isRunning ? (
            <Pressable onPress={onKill} style={styles.killBtn}>
              <Text style={styles.killText}>Kill</Text>
            </Pressable>
          ) : (
            <Pressable onPress={onDisconnect} style={styles.disconnectBtn}>
              <Text style={styles.disconnectText}>Disconnect</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Chat view — primary content */}
      <ChatView
        events={events}
        pendingApprovals={pendingApprovals}
        onDecide={onDecide}
      />

      {/* New session input (only when idle) */}
      {!isRunning && (
        <View style={styles.runPanel}>
          <View style={styles.promptRow}>
            <TextInput
              style={[styles.input, styles.promptInput, isVoiceInterim && styles.promptInterim]}
              value={prompt}
              onChangeText={(t: string) => { setPrompt(t); setIsVoiceInterim(false); }}
              placeholder="What should Claude do?"
              placeholderTextColor="#6b7280"
              multiline
              autoCorrect={false}
              onSubmitEditing={handleRun}
            />
            <VoiceButton onTranscript={handleVoiceTranscript} />
          </View>
          <View style={styles.runRow}>
            <TextInput
              style={[styles.input, styles.containerInput]}
              value={container}
              onChangeText={setContainer}
              placeholder="container (optional)"
              placeholderTextColor="#6b7280"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Pressable
              style={[styles.runBtn, !prompt.trim() && styles.runBtnDisabled]}
              onPress={handleRun}
              disabled={!prompt.trim()}
            >
              <Text style={styles.runBtnText}>Run</Text>
            </Pressable>
          </View>

          <Pressable
            style={[
              styles.skipPermsToggle,
              skipPermsConfirming && styles.skipPermsToggleConfirming,
              dangerouslySkipPermissions && styles.skipPermsToggleOn,
            ]}
            onPress={handleSkipPermsToggle}
          >
            <View style={[styles.skipPermsIndicator, dangerouslySkipPermissions && styles.skipPermsIndicatorOn]} />
            <Text style={[
              styles.skipPermsText,
              skipPermsConfirming && styles.skipPermsTextConfirming,
              dangerouslySkipPermissions && styles.skipPermsTextOn,
            ]}>
              {dangerouslySkipPermissions
                ? '⚡ dangerously-skip-permissions ON'
                : skipPermsConfirming
                ? '⚠ Tap again to enable'
                : 'dangerously-skip-permissions off'}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Event log drawer */}
      <View style={styles.logDrawer}>
        <Pressable
          style={styles.logHeader}
          onPress={() => setLogExpanded(x => !x)}
        >
          <Text style={styles.logLabel}>
            Event log{events.length > 0 ? ` (${events.length})` : ''}
          </Text>
          <View style={styles.logHeaderRight}>
            {events.length > 0 && (
              <Pressable
                onPress={handleShareLog}
                hitSlop={12}
                style={styles.shareBtn}
              >
                <Text style={styles.shareBtnText}>Share</Text>
              </Pressable>
            )}
            <Text style={styles.logChevron}>{logExpanded ? '▼' : '▲'}</Text>
          </View>
        </Pressable>
        {logExpanded && (
          <View style={styles.logBody}>
            <EventFeed events={events} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },

  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { color: '#a1a1aa', fontSize: 13, fontWeight: '500' },
  seqBadge: { color: '#71717a', fontSize: 11, marginLeft: 4 },
  sessionBadge: {
    backgroundColor: '#14280f',
    borderRadius: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#1f4a18',
  },
  sessionBadgeText: { color: '#4ade80', fontSize: 11, fontWeight: '600', letterSpacing: 0.3 },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  gearBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  gearText: {
    color: '#a1a1aa',
    fontSize: 18,
  },
  disconnectBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  disconnectText: { color: '#a1a1aa', fontSize: 13 },
  killBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#7f1d1d',
    backgroundColor: '#1c0a0a',
  },
  killText: { color: '#f87171', fontSize: 13, fontWeight: '600' },

  runPanel: {
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
    padding: 12,
    gap: 8,
  },
  input: {
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 10,
    color: '#f0f0f0',
    fontSize: 14,
  },
  promptRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  promptInput: { flex: 1, minHeight: 52, maxHeight: 120, textAlignVertical: 'top' },
  promptInterim: { color: '#94a3b8' },
  runRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  containerInput: { flex: 1, fontSize: 13 },
  runBtn: { backgroundColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  runBtnDisabled: { opacity: 0.35 },
  runBtnText: { color: '#0a0a0a', fontWeight: '700', fontSize: 14 },
  skipPermsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#0d0d0d',
  },
  skipPermsToggleOn: { borderColor: '#7f1d1d', backgroundColor: '#1c0a0a' },
  skipPermsIndicator: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#333' },
  skipPermsIndicatorOn: { backgroundColor: '#ef4444' },
  skipPermsText: { color: '#9ca3af', fontSize: 12, fontWeight: '500' },
  skipPermsTextOn: { color: '#f87171', fontWeight: '700' },
  skipPermsToggleConfirming: { borderColor: '#78350f', backgroundColor: '#1c110a' },
  skipPermsTextConfirming: { color: '#fbbf24', fontWeight: '600' },

  logDrawer: {
    borderTopWidth: 1,
    borderTopColor: '#1a1a1a',
  },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  logLabel: {
    color: '#71717a',
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  logHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shareBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  shareBtnText: { color: '#9ca3af', fontSize: 11, fontWeight: '600' },
  logChevron: { color: '#71717a', fontSize: 10 },
  logBody: { maxHeight: 320 },
});
