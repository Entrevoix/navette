// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ChatView } from '../components/ChatView';
import { DirPicker } from '../components/DirPicker';
import { EventFeed } from '../components/EventFeed';
import { SessionCard } from '../components/SessionCard';
import { VoiceButton } from '../components/VoiceButton';
import { ContainerPickerScreen } from './ContainerPickerScreen';
import { FileBrowserScreen } from './FileBrowserScreen';
import { SettingsScreen } from './SettingsScreen';
import { ApprovalPolicy, ConnectionStatus, ContainerInfo, DeviceEntry, DirListingEvent, EventFrame, FileContentEvent, FileWriteResultEvent, McpServerInfo, PastSessionInfo, PendingApproval, PolicyAction, SavedPrompt, ScheduledSessionInfo, SearchResult, SecretEntry, SessionInfo, SessionStatus } from '../types';
import type { NotifyConfig, SkillInfo } from '../hooks/useNavettedWS';
import { KanbanBoard } from '../components/KanbanBoard';

interface MainScreenProps {
  status: ConnectionStatus;
  sessionStatus: SessionStatus;
  sessions: SessionInfo[];
  activeSessionId: string | null;
  onSetActiveSessionId: (id: string | null) => void;
  events: EventFrame[];
  pendingApprovals: PendingApproval[];
  lastSeq: number;
  viewStartSeq: number;
  defaultContainer?: string;
  notifyConfig: NotifyConfig | null;
  reconnecting: boolean;
  reconnectCount: number;
  onDecide: (tool_use_id: string, allow: boolean) => void;
  onBatchDecide: (allow: boolean) => void;
  onDisconnect: () => void;
  onRun: (prompt: string, container?: string, dangerouslySkipPermissions?: boolean, workDir?: string, command?: string, injectSecrets?: boolean, agentType?: string) => void;
  onKill: (sessionId?: string) => void;
  onSendInput: (text: string) => void;
  onRequestNotifyConfig: () => void;
  onSendTestNotification: () => void;
  testNotificationResult: 'idle' | 'sent' | 'failed';
  listDir: (path: string, cb: (ev: DirListingEvent) => void) => void;
  readFile: (path: string, cb: (ev: FileContentEvent) => void) => void;
  writeFile: (path: string, content: string, cb: (ev: FileWriteResultEvent) => void) => void;
  skills: SkillInfo[];
  onListSkills: () => void;
  pastSessions: PastSessionInfo[];
  sessionHistory: Record<string, EventFrame[]>;
  onListPastSessions: () => void;
  onGetSessionHistory: (sessionId: string) => void;
  scheduledSessions: ScheduledSessionInfo[];
  onScheduleSession: (prompt: string, scheduledAt: number) => void;
  onCancelScheduledSession: (id: string) => void;
  onListScheduledSessions: () => void;
  savedPrompts: SavedPrompt[];
  onListPrompts: () => void;
  onSavePrompt: (title: string, body: string, tags?: string[]) => void;
  onUpdatePrompt: (id: string, title: string, body: string, tags?: string[]) => void;
  onDeletePrompt: (id: string) => void;
  secrets: SecretEntry[];
  onListSecrets: () => void;
  onSetSecret: (name: string, value: string) => void;
  onDeleteSecret: (name: string) => void;
  devices: DeviceEntry[];
  onListDevices: () => void;
  onRevokeDevice: (deviceId: string) => void;
  onRenameDevice: (deviceId: string, name: string) => void;
  approvalPolicies: ApprovalPolicy[];
  onGetApprovalPolicies: () => void;
  onSetApprovalPolicy: (tool_name: string, action: PolicyAction) => void;
  onDeleteApprovalPolicy: (tool_name: string) => void;
  mcpServers: McpServerInfo[];
  onListMcpServers: () => void;
  containers: ContainerInfo[];
  onListContainers: () => void;
  searchResults: SearchResult[];
  onSearchSessions: (query: string) => void;
  hasUnread: (sessionId: string) => boolean;
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
  sessions,
  activeSessionId,
  onSetActiveSessionId,
  events,
  pendingApprovals,
  lastSeq,
  viewStartSeq,
  defaultContainer,
  notifyConfig,
  reconnecting,
  reconnectCount,
  onDecide,
  onBatchDecide,
  onDisconnect,
  onRun,
  onKill,
  onSendInput,
  onRequestNotifyConfig,
  onSendTestNotification,
  testNotificationResult,
  listDir,
  readFile,
  writeFile,
  skills,
  onListSkills,
  pastSessions,
  sessionHistory,
  onListPastSessions,
  onGetSessionHistory,
  scheduledSessions,
  onScheduleSession,
  onCancelScheduledSession,
  onListScheduledSessions,
  savedPrompts,
  onListPrompts,
  onSavePrompt,
  onUpdatePrompt,
  onDeletePrompt,
  secrets,
  onListSecrets,
  onSetSecret,
  onDeleteSecret,
  devices,
  onListDevices,
  onRevokeDevice,
  onRenameDevice,
  approvalPolicies,
  onGetApprovalPolicies,
  onSetApprovalPolicy,
  onDeleteApprovalPolicy,
  mcpServers,
  onListMcpServers,
  containers,
  onListContainers,
  searchResults,
  onSearchSessions,
  hasUnread,
}: MainScreenProps) {
  const AGENTS = ['claude', 'codex', 'gemini'] as const;
  type AgentName = typeof AGENTS[number];

  const [prompt, setPrompt] = useState('');
  const [isVoiceInterim, setIsVoiceInterim] = useState(false);
  const promptRef = useRef('');
  const voiceActiveRef = useRef(false);
  const preVoicePromptRef = useRef('');
  const [container, setContainer] = useState(defaultContainer ?? '');
  const [workDir, setWorkDir] = useState('');
  const [customCommand, setCustomCommand] = useState('');
  const [selectedAgent, setSelectedAgent] = useState<AgentName>('claude');
  const [injectSecrets, setInjectSecrets] = useState(false);
  const [dirPickerOpen, setDirPickerOpen] = useState(false);
  const [containerPickerOpen, setContainerPickerOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [filesVisible, setFilesVisible] = useState(false);
  const [dangerouslySkipPermissions, setDangerouslySkipPermissions] = useState(false);
  const [skipPermsConfirming, setSkipPermsConfirming] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [logExpanded, setLogExpanded] = useState(false);
  const [reconnectedFlash, setReconnectedFlash] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'board'>('list');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectedFlashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevReconnectingRef = useRef(false);

  useEffect(() => {
    AsyncStorage.getItem('navette_view_mode').then((v: string | null) => {
      if (v === 'board' || v === 'list') setViewMode(v);
    });
  }, []);

  useEffect(() => {
    const key = container ? `navette_workdir_${container}` : 'navette_workdir_host';
    AsyncStorage.getItem(key).then((v: string | null) => { setWorkDir(v ?? ''); });
  }, [container]);

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

  // Flash "Reconnected" briefly when reconnecting transitions from true→false (i.e. just reconnected)
  useEffect(() => {
    if (prevReconnectingRef.current && !reconnecting && status === 'connected' && reconnectCount > 0) {
      setReconnectedFlash(true);
      if (reconnectedFlashTimerRef.current !== null) clearTimeout(reconnectedFlashTimerRef.current);
      reconnectedFlashTimerRef.current = setTimeout(() => {
        setReconnectedFlash(false);
        reconnectedFlashTimerRef.current = null;
      }, 2000);
    }
    prevReconnectingRef.current = reconnecting;
  }, [reconnecting, status, reconnectCount]);

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

  const handleVoiceTranscript = useCallback((text: string, isFinal: boolean) => {
    if (!voiceActiveRef.current && !isFinal) {
      preVoicePromptRef.current = promptRef.current;
      voiceActiveRef.current = true;
    }
    const prefix = preVoicePromptRef.current;
    setPrompt(prefix ? `${prefix} ${text}` : text);
    promptRef.current = prefix ? `${prefix} ${text}` : text;
    setIsVoiceInterim(!isFinal);
    if (isFinal) voiceActiveRef.current = false;
  }, []);

  const handleRun = () => {
    const p = prompt.trim();
    if (!p) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const cmd = customCommand.trim() || undefined;
    const wd = workDir.trim() || undefined;
    onRun(p, container.trim() || undefined, dangerouslySkipPermissions, wd, cmd, injectSecrets, selectedAgent);
    if (wd) {
      const key = container.trim() ? `navette_workdir_${container.trim()}` : 'navette_workdir_host';
      AsyncStorage.setItem(key, wd);
    }
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
      <FileBrowserScreen
        visible={filesVisible}
        onClose={() => setFilesVisible(false)}
        listDir={listDir}
        readFile={readFile}
        writeFile={writeFile}
        initialPath={workDir || '~'}
      />
      <SettingsScreen
        visible={settingsVisible}
        onClose={() => setSettingsVisible(false)}
        notifyConfig={notifyConfig}
        onRequestNotifyConfig={onRequestNotifyConfig}
        onSendTestNotification={onSendTestNotification}
        testNotificationResult={testNotificationResult}
        skills={skills}
        onListSkills={onListSkills}
        onRunSkill={(prompt) => { onRun(prompt); setSettingsVisible(false); }}
        pastSessions={pastSessions}
        sessionHistory={sessionHistory}
        onListPastSessions={onListPastSessions}
        onGetSessionHistory={onGetSessionHistory}
        scheduledSessions={scheduledSessions}
        onScheduleSession={onScheduleSession}
        onCancelScheduledSession={onCancelScheduledSession}
        onListScheduledSessions={onListScheduledSessions}
        savedPrompts={savedPrompts}
        onListPrompts={onListPrompts}
        onSavePrompt={onSavePrompt}
        onUpdatePrompt={onUpdatePrompt}
        onDeletePrompt={onDeletePrompt}
        onUsePrompt={(body) => { setPrompt(body); setSettingsVisible(false); }}
        secrets={secrets}
        onListSecrets={onListSecrets}
        onSetSecret={onSetSecret}
        onDeleteSecret={onDeleteSecret}
        devices={devices}
        onListDevices={onListDevices}
        onRevokeDevice={onRevokeDevice}
        onRenameDevice={onRenameDevice}
        approvalPolicies={approvalPolicies}
        onGetApprovalPolicies={onGetApprovalPolicies}
        onSetApprovalPolicy={onSetApprovalPolicy}
        onDeleteApprovalPolicy={onDeleteApprovalPolicy}
        onBrowseFiles={() => { setSettingsVisible(false); setFilesVisible(true); }}
        mcpServers={mcpServers}
        onListMcpServers={onListMcpServers}
        searchResults={searchResults}
        onSearchSessions={onSearchSessions}
      />

      {/* Top bar */}
      <View style={styles.topBar}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: STATUS_COLOR[status] }]} />
          <Text style={styles.statusText}>{status}</Text>
          {lastSeq > 0 && <Text style={styles.seqBadge}>seq {lastSeq}</Text>}
          {reconnecting && (
            <View style={styles.reconnectBadge}>
              <View style={styles.reconnectDot} />
              <Text style={styles.reconnectText}>Reconnecting…</Text>
            </View>
          )}
          {reconnectedFlash && !reconnecting && (
            <View style={styles.reconnectedBadge}>
              <Text style={styles.reconnectedText}>Reconnected</Text>
            </View>
          )}
          {isRunning && (
            <View style={styles.sessionBadge}>
              <Text style={styles.sessionBadgeText}>running · {formatElapsed(elapsed)}</Text>
            </View>
          )}
        </View>
        <View style={styles.topBarActions}>
          <Pressable onPress={() => setFilesVisible(true)} hitSlop={10} style={styles.gearBtn}>
            <Text style={styles.gearText}>{'\u{1F4C1}'}</Text>
          </Pressable>
          <Pressable onPress={() => setSettingsVisible(true)} hitSlop={10} style={styles.gearBtn}>
            <Text style={styles.gearText}>⚙</Text>
          </Pressable>
          {isRunning ? (
            <Pressable onPress={() => onKill(activeSessionId ?? undefined)} style={styles.killBtn}>
              <Text style={styles.killText}>Kill</Text>
            </Pressable>
          ) : (
            <Pressable onPress={onDisconnect} style={styles.disconnectBtn}>
              <Text style={styles.disconnectText}>Disconnect</Text>
            </Pressable>
          )}
        </View>
      </View>

      {/* Session dashboard (multiple sessions) or pill switcher (single session) */}
      {sessions.length > 1 && (
        <View style={styles.dashboardRow}>
          <View style={styles.viewToggleRow}>
            <Pressable
              style={[styles.viewToggle, viewMode === 'list' && styles.viewToggleActive]}
              onPress={() => { setViewMode('list'); AsyncStorage.setItem('navette_view_mode', 'list'); }}
            >
              <Text style={[styles.viewToggleText, viewMode === 'list' && styles.viewToggleTextActive]}>List</Text>
            </Pressable>
            <Pressable
              style={[styles.viewToggle, viewMode === 'board' && styles.viewToggleActive]}
              onPress={() => { setViewMode('board'); AsyncStorage.setItem('navette_view_mode', 'board'); }}
            >
              <Text style={[styles.viewToggleText, viewMode === 'board' && styles.viewToggleTextActive]}>Board</Text>
            </Pressable>
          </View>
          {viewMode === 'board' ? (
            <KanbanBoard
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSelect={onSetActiveSessionId}
              hasUnread={hasUnread}
            />
          ) : (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={sessions}
              keyExtractor={s => s.session_id}
              contentContainerStyle={styles.dashboardContent}
              renderItem={({ item: s }) => (
                <SessionCard
                  session={s}
                  isActive={s.session_id === activeSessionId}
                  onSelect={onSetActiveSessionId}
                  hasPendingApproval={s.session_id === activeSessionId && pendingApprovals.length > 0}
                  hasUnread={hasUnread(s.session_id)}
                />
              )}
            />
          )}
        </View>
      )}
      {sessions.length === 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.pillsRow}
          contentContainerStyle={styles.pillsContent}
        >
          {sessions.map(s => (
            <Pressable
              key={s.session_id}
              style={[styles.pill, s.session_id === activeSessionId && styles.pillActive]}
              onPress={() => onSetActiveSessionId(s.session_id)}
            >
              <Text
                numberOfLines={1}
                style={[styles.pillText, s.session_id === activeSessionId && styles.pillTextActive]}
              >
                {s.container ?? s.prompt.split(' ').slice(0, 3).join(' ')}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Chat view — primary content */}
      <ChatView
        events={events}
        pendingApprovals={pendingApprovals}
        onDecide={onDecide}
        onBatchDecide={onBatchDecide}
        viewStartSeq={viewStartSeq}
        activeSessionId={activeSessionId}
        sessionRunning={isRunning}
        onSendInput={isRunning && activeSessionId ? onSendInput : undefined}
      />

      {/* New session input (only when idle) */}
      {!isRunning && (
        <View style={styles.runPanel}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.agentRow} contentContainerStyle={styles.agentRowContent}>
            {AGENTS.map(a => (
              <Pressable
                key={a}
                style={[styles.agentPill, selectedAgent === a && styles.agentPillActive]}
                onPress={() => setSelectedAgent(a)}
              >
                <Text style={[styles.agentPillText, selectedAgent === a && styles.agentPillTextActive]}>{a}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <TextInput
            style={[styles.input, styles.promptInput, isVoiceInterim && styles.promptInterim]}
            value={prompt}
            onChangeText={(t: string) => { setPrompt(t); promptRef.current = t; setIsVoiceInterim(false); }}
            placeholder="What should Claude do?"
            placeholderTextColor="#6b7280"
            multiline
            autoCorrect={false}
          />

          <View style={styles.actionRow}>
            <VoiceButton onTranscript={handleVoiceTranscript} />
            <View style={styles.actionSpacer} />
            <Pressable
              style={[styles.runBtn, !prompt.trim() && styles.runBtnDisabled]}
              onPress={handleRun}
              disabled={!prompt.trim()}
            >
              <Text style={styles.runBtnText}>Run</Text>
            </Pressable>
          </View>

          <Pressable style={styles.advancedHeader} onPress={() => setAdvancedOpen(o => !o)}>
            <Text style={styles.advancedHeaderText}>Advanced {advancedOpen ? '▴' : '▾'}</Text>
          </Pressable>

          {advancedOpen && (
            <View style={styles.advancedBody}>
              <Pressable onPress={() => setContainerPickerOpen(true)} style={styles.dirBtn}>
                <Text style={styles.dirBtnText} numberOfLines={1}>
                  {container || '📦 Container (optional)'}
                </Text>
              </Pressable>

              <Pressable onPress={() => setDirPickerOpen(true)} style={styles.dirBtn}>
                <Text style={styles.dirBtnText} numberOfLines={1}>
                  {workDir || '📁 Work directory (optional)'}
                </Text>
              </Pressable>

              <TextInput
                style={[styles.input, styles.advancedInput]}
                value={customCommand}
                onChangeText={setCustomCommand}
                placeholder="Custom command (overrides agent picker)"
                placeholderTextColor="#6b7280"
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Pressable
                style={[
                  styles.injectSecretsToggle,
                  injectSecrets && styles.injectSecretsToggleOn,
                ]}
                onPress={() => setInjectSecrets(v => !v)}
              >
                <View style={[styles.skipPermsIndicator, injectSecrets && styles.injectSecretsIndicatorOn]} />
                <View style={styles.skipPermsLabelCol}>
                  <Text style={[styles.skipPermsText, injectSecrets && styles.injectSecretsTextOn]}>
                    {injectSecrets ? `Inject secrets (${secrets.length})` : 'Inject secrets into session'}
                  </Text>
                  {injectSecrets && (
                    <Text style={styles.injectSecretsHint}>Secrets will be available as env vars</Text>
                  )}
                </View>
              </Pressable>

              <Pressable
                style={[
                  styles.skipPermsToggle,
                  skipPermsConfirming && styles.skipPermsToggleConfirming,
                  dangerouslySkipPermissions && styles.skipPermsToggleOn,
                ]}
                onPress={handleSkipPermsToggle}
              >
                <View style={[styles.skipPermsIndicator, dangerouslySkipPermissions && styles.skipPermsIndicatorOn]} />
                <View style={styles.skipPermsLabelCol}>
                  <Text style={[
                    styles.skipPermsText,
                    skipPermsConfirming && styles.skipPermsTextConfirming,
                    dangerouslySkipPermissions && styles.skipPermsTextOn,
                  ]}>
                    {dangerouslySkipPermissions
                      ? '⚡ dangerously-skip-permissions ON'
                      : skipPermsConfirming
                      ? '⚠ Tap again to enable'
                      : 'Dangerous: skip all approvals'}
                  </Text>
                  {dangerouslySkipPermissions && (
                    <Text style={styles.skipPermsWarning}>Auto-approves every tool use</Text>
                  )}
                </View>
              </Pressable>
            </View>
          )}

          <DirPicker
            visible={dirPickerOpen}
            onClose={() => setDirPickerOpen(false)}
            onSelect={setWorkDir}
            listDir={listDir}
          />
          <ContainerPickerScreen
            visible={containerPickerOpen}
            onClose={() => setContainerPickerOpen(false)}
            containers={containers}
            onRefresh={onListContainers}
            selectedContainer={container}
            onSelect={setContainer}
          />
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
  reconnectBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#1c1500',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#3a2e00',
  },
  reconnectDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fbbf24' },
  reconnectText: { color: '#fbbf24', fontSize: 11, fontWeight: '600' },
  reconnectedBadge: {
    backgroundColor: '#0f2818',
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: '#1f4a18',
  },
  reconnectedText: { color: '#4ade80', fontSize: 11, fontWeight: '600' },
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
  promptInput: { minHeight: 52, maxHeight: 120, textAlignVertical: 'top' },
  promptInterim: { color: '#94a3b8' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionSpacer: { flex: 1 },
  containerInput: { fontSize: 13 },
  runBtn: { backgroundColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 20, minHeight: 44, justifyContent: 'center', alignItems: 'center' },
  runBtnDisabled: { opacity: 0.35 },
  runBtnText: { color: '#0a0a0a', fontWeight: '700', fontSize: 14 },
  agentRow: { flexGrow: 0 },
  agentRowContent: { flexDirection: 'row', gap: 6, paddingVertical: 4 },
  agentPill: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12, borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#0d0d0d' },
  agentPillActive: { borderColor: '#818cf8', backgroundColor: '#1e1b4b' },
  agentPillText: { color: '#71717a', fontSize: 12, fontWeight: '500' },
  agentPillTextActive: { color: '#a5b4fc', fontWeight: '700' },
  dirBtn: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#0d0d0d',
    padding: 10,
  },
  dirBtnText: { color: '#9ca3af', fontSize: 13, fontFamily: 'Menlo' },
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
  skipPermsLabelCol: { flex: 1 },
  skipPermsWarning: { color: '#ef4444', fontSize: 10, marginTop: 2 },

  injectSecretsToggle: {
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
  injectSecretsToggleOn: { borderColor: '#166534', backgroundColor: '#0a1a0a' },
  injectSecretsIndicatorOn: { backgroundColor: '#4ade80' },
  injectSecretsTextOn: { color: '#4ade80', fontWeight: '700' },
  injectSecretsHint: { color: '#4ade80', fontSize: 10, marginTop: 2 },

  advancedHeader: {
    paddingVertical: 6,
    paddingHorizontal: 2,
  },
  advancedHeaderText: {
    color: '#52525b',
    fontSize: 12,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  advancedBody: {
    gap: 8,
  },
  advancedInput: {
    fontSize: 13,
  },

  dashboardRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    paddingVertical: 10,
  },
  dashboardContent: {
    paddingHorizontal: 12,
  },
  viewToggleRow: {
    flexDirection: 'row',
    alignSelf: 'flex-end',
    marginRight: 12,
    marginBottom: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    overflow: 'hidden',
  },
  viewToggle: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: '#0d0d0d',
  },
  viewToggleActive: {
    backgroundColor: '#1a1a2e',
  },
  viewToggleText: {
    color: '#555',
    fontSize: 11,
    fontWeight: '600',
  },
  viewToggleTextActive: {
    color: '#93c5fd',
  },

  pillsRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
    maxHeight: 44,
  },
  pillsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#0d0d0d',
    maxWidth: 160,
  },
  pillActive: {
    borderColor: '#4ade80',
    backgroundColor: '#14280f',
  },
  pillText: { color: '#71717a', fontSize: 12, fontWeight: '500' },
  pillTextActive: { color: '#4ade80', fontWeight: '700' },

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
