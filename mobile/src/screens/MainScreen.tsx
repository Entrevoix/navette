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
import { Appbar, Button, Chip, SegmentedButtons, useTheme } from 'react-native-paper';
import { getStatusColors, getSemanticColors } from '../theme';
import { useThemeMode } from '../ThemeContext';
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
  const theme = useTheme();
  const { isDark } = useThemeMode();
  const statusColors = getStatusColors(theme, isDark);
  const semantic = getSemanticColors(isDark);
  const statusColorMap: Record<ConnectionStatus, string> = {
    disconnected: statusColors.disconnected,
    connecting: statusColors.connecting,
    authenticating: statusColors.connecting,
    connected: statusColors.connected,
    error: statusColors.error,
  };

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
      const id = setInterval(() => setElapsed((s: number) => s + 1), 1000);
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
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
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
      <Appbar.Header style={{ backgroundColor: theme.colors.surface, borderBottomWidth: 1, borderBottomColor: theme.colors.outlineVariant }} elevated={false}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: statusColorMap[status] }]} />
          <Text style={[styles.statusText, { color: theme.colors.onSurfaceVariant }]}>{status}</Text>
          {lastSeq > 0 && <Text style={[styles.seqBadge, { color: theme.colors.outline }]}>seq {lastSeq}</Text>}
          {reconnecting && (
            <Chip icon="sync" compact textStyle={{ fontSize: 11 }} style={{ backgroundColor: semantic.warningContainer }}>Reconnecting…</Chip>
          )}
          {reconnectedFlash && !reconnecting && (
            <Chip icon="check-circle" compact textStyle={{ fontSize: 11 }} style={{ backgroundColor: semantic.successContainer }}>Reconnected</Chip>
          )}
          {isRunning && (
            <Chip icon="play-circle" compact textStyle={{ fontSize: 11 }} style={{ backgroundColor: semantic.successContainer }}>running · {formatElapsed(elapsed)}</Chip>
          )}
        </View>
        <Appbar.Action icon="folder-outline" onPress={() => setFilesVisible(true)} />
        <Appbar.Action icon="cog-outline" onPress={() => setSettingsVisible(true)} />
        {isRunning ? (
          <Button mode="text" textColor={theme.colors.error} onPress={() => onKill(activeSessionId ?? undefined)} compact>Kill</Button>
        ) : (
          <Button mode="text" textColor={theme.colors.onSurfaceVariant} onPress={onDisconnect} compact>Disconnect</Button>
        )}
      </Appbar.Header>

      <View style={styles.contentWrapper}>
      {/* Session dashboard (multiple sessions) or pill switcher (single session) */}
      {sessions.length > 1 && (
        <View style={[styles.dashboardRow, { borderBottomColor: theme.colors.outlineVariant }]}>
          <SegmentedButtons
            value={viewMode}
            onValueChange={(v: string) => { setViewMode(v as 'list' | 'board'); AsyncStorage.setItem('navette_view_mode', v); }}
            buttons={[
              { value: 'list', label: 'List' },
              { value: 'board', label: 'Board' },
            ]}
            style={{ alignSelf: 'flex-end', marginRight: 12, marginBottom: 6 }}
            density="small"
          />
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
              keyExtractor={(s: SessionInfo) => s.session_id}
              contentContainerStyle={styles.dashboardContent}
              renderItem={({ item: s }: { item: SessionInfo }) => (
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
          style={[styles.pillsRow, { borderBottomColor: theme.colors.outlineVariant }]}
          contentContainerStyle={styles.pillsContent}
        >
          {sessions.map((s: SessionInfo) => (
            <Chip
              key={s.session_id}
              mode="outlined"
              selected={s.session_id === activeSessionId}
              onPress={() => onSetActiveSessionId(s.session_id)}
              compact
              style={{ maxWidth: 160 }}
            >
              {s.container ?? s.prompt.split(' ').slice(0, 3).join(' ')}
            </Chip>
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
        <View style={[styles.runPanel, { borderTopColor: theme.colors.outlineVariant }]}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.agentRow} contentContainerStyle={styles.agentRowContent}>
            {AGENTS.map(a => (
              <Chip
                key={a}
                mode="outlined"
                selected={selectedAgent === a}
                onPress={() => setSelectedAgent(a)}
                compact
              >
                {a}
              </Chip>
            ))}
          </ScrollView>

          <TextInput
            style={[styles.input, styles.promptInput, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outline, color: theme.colors.onSurface }, isVoiceInterim && { color: theme.colors.onSurfaceVariant }]}
            value={prompt}
            onChangeText={(t: string) => { setPrompt(t); promptRef.current = t; setIsVoiceInterim(false); }}
            placeholder="What should Claude do?"
            placeholderTextColor={theme.colors.onSurfaceVariant}
            multiline
            autoCorrect={false}
          />

          <View style={styles.actionRow}>
            <VoiceButton onTranscript={handleVoiceTranscript} />
            <View style={styles.actionSpacer} />
            <Button mode="contained" onPress={handleRun} disabled={!prompt.trim()} style={{ minHeight: 44 }}>
              Run
            </Button>
          </View>

          <Pressable style={styles.advancedHeader} onPress={() => setAdvancedOpen((o: boolean) => !o)}>
            <Text style={[styles.advancedHeaderText, { color: theme.colors.onSurfaceVariant }]}>Advanced {advancedOpen ? '▴' : '▾'}</Text>
          </Pressable>

          {advancedOpen && (
            <View style={styles.advancedBody}>
              <Pressable onPress={() => setContainerPickerOpen(true)} style={[styles.dirBtn, { borderColor: theme.colors.outline, backgroundColor: theme.colors.surfaceVariant }]}>
                <Text style={[styles.dirBtnText, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                  {container || '📦 Container (optional)'}
                </Text>
              </Pressable>

              <Pressable onPress={() => setDirPickerOpen(true)} style={[styles.dirBtn, { borderColor: theme.colors.outline, backgroundColor: theme.colors.surfaceVariant }]}>
                <Text style={[styles.dirBtnText, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                  {workDir || '📁 Work directory (optional)'}
                </Text>
              </Pressable>

              <TextInput
                style={[styles.input, styles.advancedInput, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outline, color: theme.colors.onSurface }]}
                value={customCommand}
                onChangeText={setCustomCommand}
                placeholder="Custom command (overrides agent picker)"
                placeholderTextColor={theme.colors.onSurfaceVariant}
                autoCapitalize="none"
                autoCorrect={false}
              />

              <Pressable
                style={[
                  styles.toggleRow,
                  { borderColor: theme.colors.outline, backgroundColor: theme.colors.elevation.level1 },
                  injectSecrets && { borderColor: semantic.onSuccessContainer, backgroundColor: semantic.successContainer },
                ]}
                onPress={() => setInjectSecrets((v: boolean) => !v)}
              >
                <View style={[styles.toggleDot, { backgroundColor: theme.colors.outlineVariant }, injectSecrets && { backgroundColor: semantic.success }]} />
                <View style={styles.skipPermsLabelCol}>
                  <Text style={[{ color: theme.colors.onSurfaceVariant, fontSize: 12, fontWeight: '500' }, injectSecrets && { color: semantic.success, fontWeight: '700' }]}>
                    {injectSecrets ? `Inject secrets (${secrets.length})` : 'Inject secrets into session'}
                  </Text>
                  {injectSecrets && (
                    <Text style={{ color: semantic.success, fontSize: 10, marginTop: 2 }}>Secrets will be available as env vars</Text>
                  )}
                </View>
              </Pressable>

              <Pressable
                style={[
                  styles.toggleRow,
                  { borderColor: theme.colors.outline, backgroundColor: theme.colors.elevation.level1 },
                  skipPermsConfirming && { borderColor: semantic.onWarningContainer, backgroundColor: semantic.warningContainer },
                  dangerouslySkipPermissions && { borderColor: theme.colors.error, backgroundColor: theme.colors.errorContainer },
                ]}
                onPress={handleSkipPermsToggle}
              >
                <View style={[styles.toggleDot, { backgroundColor: theme.colors.outlineVariant }, dangerouslySkipPermissions && { backgroundColor: theme.colors.error }]} />
                <View style={styles.skipPermsLabelCol}>
                  <Text style={[
                    { color: theme.colors.onSurfaceVariant, fontSize: 12, fontWeight: '500' },
                    skipPermsConfirming && { color: semantic.warning, fontWeight: '600' },
                    dangerouslySkipPermissions && { color: theme.colors.error, fontWeight: '700' },
                  ]}>
                    {dangerouslySkipPermissions
                      ? '⚡ dangerously-skip-permissions ON'
                      : skipPermsConfirming
                      ? '⚠ Tap again to enable'
                      : 'Dangerous: skip all approvals'}
                  </Text>
                  {dangerouslySkipPermissions && (
                    <Text style={{ color: theme.colors.error, fontSize: 10, marginTop: 2 }}>Auto-approves every tool use</Text>
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
      <View style={[styles.logDrawer, { borderTopColor: theme.colors.outlineVariant }]}>
        <Pressable
          style={styles.logHeader}
          onPress={() => setLogExpanded((x: boolean) => !x)}
        >
          <Text style={[styles.logLabel, { color: theme.colors.onSurfaceVariant }]}>
            Event log{events.length > 0 ? ` (${events.length})` : ''}
          </Text>
          <View style={styles.logHeaderRight}>
            {events.length > 0 && (
              <Pressable
                onPress={handleShareLog}
                hitSlop={12}
                style={[styles.shareBtn, { borderColor: theme.colors.outline }]}
              >
                <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 11, fontWeight: '600' }}>Share</Text>
              </Pressable>
            )}
            <Text style={{ color: theme.colors.onSurfaceVariant, fontSize: 10 }}>{logExpanded ? '▼' : '▲'}</Text>
          </View>
        </Pressable>
        {logExpanded && (
          <View style={styles.logBody}>
            <EventFeed events={events} />
          </View>
        )}
      </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  contentWrapper: { flex: 1, maxWidth: 600, alignSelf: 'center', width: '100%' },

  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 13, fontWeight: '500' },
  seqBadge: { fontSize: 11, marginLeft: 4 },

  runPanel: { borderTopWidth: 1, padding: 12, gap: 8 },
  input: { borderRadius: 8, borderWidth: 1, padding: 10, fontSize: 14 },
  promptInput: { minHeight: 52, maxHeight: 120, textAlignVertical: 'top' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionSpacer: { flex: 1 },
  agentRow: { flexGrow: 0 },
  agentRowContent: { flexDirection: 'row', gap: 6, paddingVertical: 4 },
  dirBtn: { borderRadius: 8, borderWidth: 1, padding: 10 },
  dirBtnText: { fontSize: 13, fontFamily: 'Menlo' },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  toggleDot: { width: 8, height: 8, borderRadius: 4 },
  skipPermsLabelCol: { flex: 1 },

  advancedHeader: { paddingVertical: 6, paddingHorizontal: 2 },
  advancedHeaderText: { fontSize: 12, fontWeight: '600', letterSpacing: 0.3 },
  advancedBody: { gap: 8 },
  advancedInput: { fontSize: 13 },

  dashboardRow: { borderBottomWidth: 1, paddingVertical: 10 },
  dashboardContent: { paddingHorizontal: 12 },

  pillsRow: { borderBottomWidth: 1, maxHeight: 44 },
  pillsContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    gap: 6,
  },

  logDrawer: { borderTopWidth: 1 },
  logHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  logLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5 },
  logHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  shareBtn: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, borderWidth: 1 },
  logBody: { maxHeight: 320 },
});
