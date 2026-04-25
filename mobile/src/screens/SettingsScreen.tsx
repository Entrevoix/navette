// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useState } from 'react';
import {
  Linking,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, SegmentedButtons, useTheme } from 'react-native-paper';
import { useThemeMode } from '../ThemeContext';
import type { ThemeMode } from '../theme';

import { DEFAULT_WHISPER_ENDPOINT, STT_ENGINE_KEY, STT_RECOGNIZER_LABEL_KEY, STT_RECOGNIZER_PKG_KEY, WHISPER_API_KEY_STORAGE, WHISPER_ENDPOINT_KEY } from '../components/VoiceButton';
import { PromptLibraryScreen } from './PromptLibraryScreen';
import { ScheduleScreen } from './ScheduleScreen';
import { DevicesScreen } from './DevicesScreen';
import { ApprovalPolicyScreen } from './ApprovalPolicyScreen';
import { SecretsScreen } from './SecretsScreen';
import { SessionHistoryScreen } from './SessionHistoryScreen';
import { SkillsScreen } from './SkillsScreen';
import { McpServersScreen } from './McpServersScreen';
import type { SkillInfo } from '../hooks/useNavettedWS';
import type { ApprovalPolicy, DeviceEntry, EventFrame, McpServerInfo, PastSessionInfo, PolicyAction, SavedPrompt, ScheduledSessionInfo, SearchResult, SecretEntry } from '../types';

const TS_API_KEY_STORAGE = 'tailscale_api_key';

interface NotifyConfig {
  topic: string;
  base_url: string;
}

interface SettingsScreenProps {
  visible: boolean;
  onClose: () => void;
  notifyConfig: NotifyConfig | null;
  onRequestNotifyConfig: () => void;
  onSendTestNotification: () => void;
  testNotificationResult: 'idle' | 'sent' | 'failed';
  skills: SkillInfo[];
  onListSkills: () => void;
  onRunSkill: (prompt: string) => void;
  pastSessions: PastSessionInfo[];
  sessionHistory: Record<string, EventFrame[]>;
  onListPastSessions: () => void;
  onGetSessionHistory: (sessionId: string) => void;
  searchResults: SearchResult[];
  onSearchSessions: (query: string) => void;
  scheduledSessions: ScheduledSessionInfo[];
  onScheduleSession: (prompt: string, scheduledAt: number) => void;
  onCancelScheduledSession: (id: string) => void;
  onListScheduledSessions: () => void;
  savedPrompts: SavedPrompt[];
  onListPrompts: () => void;
  onSavePrompt: (title: string, body: string, tags?: string[]) => void;
  onUpdatePrompt: (id: string, title: string, body: string, tags?: string[]) => void;
  onDeletePrompt: (id: string) => void;
  onUsePrompt: (body: string) => void;
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
  onBrowseFiles?: () => void;
  mcpServers: McpServerInfo[];
  onListMcpServers: () => void;
}

export function SettingsScreen({ visible, onClose, notifyConfig, onRequestNotifyConfig, onSendTestNotification, testNotificationResult, skills, onListSkills, onRunSkill, pastSessions, sessionHistory, onListPastSessions, onGetSessionHistory, searchResults, onSearchSessions, scheduledSessions, onScheduleSession, onCancelScheduledSession, onListScheduledSessions, savedPrompts, onListPrompts, onSavePrompt, onUpdatePrompt, onDeletePrompt, onUsePrompt, secrets, onListSecrets, onSetSecret, onDeleteSecret, devices, onListDevices, onRevokeDevice, onRenameDevice, approvalPolicies, onGetApprovalPolicies, onSetApprovalPolicy, onDeleteApprovalPolicy, onBrowseFiles, mcpServers, onListMcpServers }: SettingsScreenProps) {
  const theme = useTheme();
  const { mode: themeMode, setMode: setThemeMode } = useThemeMode();
  const [copied, setCopied] = useState(false);
  const [testFeedback, setTestFeedback] = useState<'idle' | 'sent' | 'failed'>('idle');

  useEffect(() => {
    if (testNotificationResult === 'idle') return;
    setTestFeedback(testNotificationResult);
    const timer = setTimeout(() => setTestFeedback('idle'), 3000);
    return () => clearTimeout(timer);
  }, [testNotificationResult]);
  const [tsApiKey, setTsApiKey] = useState('');
  const [tsKeySaved, setTsKeySaved] = useState(false);
  const [sttEngine, setSttEngine] = useState<'ondevice' | 'whisper'>('ondevice');
  const [recognizerLabel, setRecognizerLabel] = useState<string | null>(null);
  const [whisperApiKey, setWhisperApiKey] = useState('');
  const [whisperEndpoint, setWhisperEndpoint] = useState('');
  const [whisperSaved, setWhisperSaved] = useState(false);
  const [skillsVisible, setSkillsVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [scheduleVisible, setScheduleVisible] = useState(false);
  const [promptLibraryVisible, setPromptLibraryVisible] = useState(false);
  const [secretsVisible, setSecretsVisible] = useState(false);
  const [devicesVisible, setDevicesVisible] = useState(false);
  const [policyVisible, setPolicyVisible] = useState(false);
  const [mcpVisible, setMcpVisible] = useState(false);

  useEffect(() => {
    if (visible) {
      onRequestNotifyConfig();
      AsyncStorage.getItem(TS_API_KEY_STORAGE).then((k: string | null) => { if (k) setTsApiKey(k); });
      AsyncStorage.getItem(STT_ENGINE_KEY).then(v => setSttEngine((v as 'ondevice' | 'whisper') ?? 'ondevice'));
      AsyncStorage.getItem(STT_RECOGNIZER_LABEL_KEY).then(v => setRecognizerLabel(v));
      AsyncStorage.getItem(WHISPER_API_KEY_STORAGE).then(v => { if (v) setWhisperApiKey(v); });
      AsyncStorage.getItem(WHISPER_ENDPOINT_KEY).then(v => { if (v) setWhisperEndpoint(v); });
    }
  }, [visible, onRequestNotifyConfig]);

  const saveTsKey = async () => {
    await AsyncStorage.setItem(TS_API_KEY_STORAGE, tsApiKey.trim());
    setTsKeySaved(true);
    setTimeout(() => setTsKeySaved(false), 2000);
  };

  const handleEngineChange = async (engine: 'ondevice' | 'whisper') => {
    setSttEngine(engine);
    await AsyncStorage.setItem(STT_ENGINE_KEY, engine);
  };

  const resetRecognizer = async () => {
    await Promise.all([
      AsyncStorage.removeItem(STT_RECOGNIZER_PKG_KEY),
      AsyncStorage.removeItem(STT_RECOGNIZER_LABEL_KEY),
    ]);
    setRecognizerLabel(null);
  };

  const saveWhisperSettings = async () => {
    await Promise.all([
      AsyncStorage.setItem(WHISPER_API_KEY_STORAGE, whisperApiKey.trim()),
      AsyncStorage.setItem(WHISPER_ENDPOINT_KEY, whisperEndpoint.trim()),
    ]);
    setWhisperSaved(true);
    setTimeout(() => setWhisperSaved(false), 2000);
  };

  const handleCopy = async () => {
    if (!notifyConfig?.topic) return;
    await Clipboard.setStringAsync(notifyConfig.topic);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubscribe = () => {
    if (!notifyConfig) return;
    const base = notifyConfig.base_url.replace(/^https?:\/\//, '');
    const isDefaultServer = base === 'ntfy.sh';
    const url = isDefaultServer
      ? `ntfy://subscribe/${notifyConfig.topic}`
      : `ntfy://${base}/subscribe/${notifyConfig.topic}`;
    Linking.openURL(url).catch(() => {
      Linking.openURL(`${notifyConfig.base_url}/${notifyConfig.topic}`);
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <PromptLibraryScreen
        visible={promptLibraryVisible}
        onClose={() => setPromptLibraryVisible(false)}
        prompts={savedPrompts}
        onRefresh={onListPrompts}
        onUse={(body) => { onUsePrompt(body); setPromptLibraryVisible(false); onClose(); }}
        onSave={onSavePrompt}
        onUpdate={onUpdatePrompt}
        onDelete={onDeletePrompt}
      />
      <SessionHistoryScreen
        visible={historyVisible}
        onClose={() => setHistoryVisible(false)}
        pastSessions={pastSessions}
        sessionHistory={sessionHistory}
        searchResults={searchResults}
        onListPastSessions={onListPastSessions}
        onGetSessionHistory={onGetSessionHistory}
        onSearchSessions={onSearchSessions}
      />
      <SkillsScreen
        visible={skillsVisible}
        onClose={() => setSkillsVisible(false)}
        skills={skills}
        onRefresh={onListSkills}
        onRun={onRunSkill}
      />
      <SecretsScreen
        visible={secretsVisible}
        onClose={() => setSecretsVisible(false)}
        secrets={secrets}
        onRefresh={onListSecrets}
        onSave={onSetSecret}
        onDelete={onDeleteSecret}
      />
      <DevicesScreen
        visible={devicesVisible}
        onClose={() => setDevicesVisible(false)}
        devices={devices}
        onRefresh={onListDevices}
        onRevoke={onRevokeDevice}
        onRename={onRenameDevice}
      />
      <ApprovalPolicyScreen
        visible={policyVisible}
        onClose={() => setPolicyVisible(false)}
        policies={approvalPolicies}
        onRefresh={onGetApprovalPolicies}
        onSet={onSetApprovalPolicy}
        onDelete={onDeleteApprovalPolicy}
      />
      <McpServersScreen
        visible={mcpVisible}
        onClose={() => setMcpVisible(false)}
        servers={mcpServers}
        onRefresh={onListMcpServers}
      />
      <ScheduleScreen
        visible={scheduleVisible}
        onClose={() => setScheduleVisible(false)}
        scheduledSessions={scheduledSessions}
        onSchedule={onScheduleSession}
        onCancel={onCancelScheduledSession}
        onRefresh={onListScheduledSessions}
      />
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>Settings</Text>
          <Button mode="text" onPress={onClose} compact>Done</Button>
        </View>

        <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Appearance</Text>
          <SegmentedButtons
            value={themeMode}
            onValueChange={(v: string) => setThemeMode(v as ThemeMode)}
            buttons={[
              { value: 'system', label: 'System' },
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
            ]}
            density="small"
          />
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Push Notifications</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            Install the ntfy app and subscribe to your topic to receive approval alerts and session updates.
          </Text>

          <View style={styles.topicRow}>
            <View style={[styles.topicBox, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}>
              <Text style={[styles.topicLabel, { color: theme.colors.onSurfaceVariant }]}>Topic</Text>
              <Text style={[styles.topicValue, { color: theme.colors.primary }]} selectable>
                {notifyConfig?.topic ?? '—'}
              </Text>
            </View>
            <Button mode="outlined" compact onPress={handleCopy} disabled={!notifyConfig?.topic}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </View>

          {notifyConfig?.base_url && notifyConfig.base_url !== 'https://ntfy.sh' && (
            <View style={styles.serverRow}>
              <Text style={[styles.serverLabel, { color: theme.colors.onSurfaceVariant }]}>Server</Text>
              <Text style={[styles.serverValue, { color: theme.colors.onSurfaceVariant }]} selectable>{notifyConfig.base_url}</Text>
            </View>
          )}

          <Button mode="contained-tonal" onPress={handleSubscribe} disabled={!notifyConfig?.topic}>
            Open in ntfy app
          </Button>

          <Button mode="outlined" onPress={onSendTestNotification} disabled={!notifyConfig?.topic}>
            {testFeedback === 'sent' ? 'Sent' : testFeedback === 'failed' ? 'Failed' : 'Send test notification'}
          </Button>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Tailscale</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            Optional. Add an API key to browse your Tailscale peers from the connect screen.
            Generate one at tailscale.com → Settings → Keys.
          </Text>
          <View style={styles.tsKeyRow}>
            <TextInput
              style={[styles.tsKeyInput, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
              value={tsApiKey}
              onChangeText={setTsApiKey}
              placeholder="tskey-api-..."
              placeholderTextColor={theme.colors.onSurfaceVariant}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Button mode="outlined" compact onPress={saveTsKey}>
              {tsKeySaved ? 'Saved' : 'Save'}
            </Button>
          </View>
        </View>
        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Session History</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            Browse and replay completed past sessions stored on the server.
          </Text>
          <Button mode="contained-tonal" onPress={() => setHistoryVisible(true)}>View Session History</Button>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Skills</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            Browse skills installed on the remote host in ~/.claude/skills/.
          </Text>
          <Button mode="contained-tonal" onPress={() => setSkillsVisible(true)}>
            Browse Skills ({skills.length})
          </Button>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Prompt Library</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            Save and reuse prompt templates for common tasks.
          </Text>
          <Button mode="contained-tonal" onPress={() => setPromptLibraryVisible(true)}>
            Browse Prompts ({savedPrompts.length})
          </Button>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Secrets Vault</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            Store encrypted secrets (API keys, tokens) and inject them as environment variables into CLI sessions.
          </Text>
          <Button mode="contained-tonal" onPress={() => setSecretsVisible(true)}>
            Manage Secrets ({secrets.length})
          </Button>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Approval Policies</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            Auto-approve safe tools (Read, Glob, Grep) and only get prompted for dangerous ones.
          </Text>
          <Button mode="contained-tonal" onPress={() => setPolicyVisible(true)}>
            Manage Policies ({approvalPolicies.length} rules)
          </Button>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Paired Devices</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            See which devices are connected and revoke access for any you don't recognize.
          </Text>
          <Button mode="contained-tonal" onPress={() => setDevicesVisible(true)}>
            Manage Devices ({devices.length})
          </Button>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Project Files</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            Browse the project file tree and edit CLAUDE.md config files from your phone.
          </Text>
          <Button mode="contained-tonal" onPress={onBrowseFiles}>Browse Files</Button>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Scheduled Sessions</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            Schedule a Claude session to start at a future time.
          </Text>
          <Button mode="contained-tonal" onPress={() => setScheduleVisible(true)}>
            Manage Scheduled ({scheduledSessions.filter((s: ScheduledSessionInfo) => !s.fired).length} pending)
          </Button>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>MCP Servers</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            View MCP servers configured in ~/.claude/settings.json on the remote host.
          </Text>
          <Button mode="contained-tonal" onPress={() => setMcpVisible(true)}>
            Browse MCP Servers ({mcpServers.length})
          </Button>
        </View>

        <View style={styles.section}>
          <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Voice Input</Text>
          <Text style={[styles.sectionSubtitle, { color: theme.colors.onSurfaceVariant }]}>
            On-device uses Android's built-in recognizer. Whisper API sends audio to OpenAI (or a compatible endpoint) for transcription.
          </Text>

          <SegmentedButtons
            value={sttEngine}
            onValueChange={(v: string) => handleEngineChange(v as 'ondevice' | 'whisper')}
            buttons={[
              { value: 'ondevice', label: 'On-device' },
              { value: 'whisper', label: 'Whisper API' },
            ]}
            density="small"
          />

          {sttEngine === 'ondevice' && (
            <View style={[styles.recognizerRow, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant }]}>
              <View style={styles.recognizerInfo}>
                <Text style={[styles.recognizerLabel, { color: theme.colors.onSurfaceVariant }]}>Recognizer</Text>
                <Text style={[styles.recognizerValue, { color: theme.colors.onSurface }]}>
                  {recognizerLabel ?? 'Auto-detect on next tap'}
                </Text>
              </View>
              {recognizerLabel && (
                <Button mode="outlined" compact onPress={resetRecognizer} textColor={theme.colors.error}>Reset</Button>
              )}
            </View>
          )}

          {sttEngine === 'whisper' && (
            <>
              <TextInput
                style={[styles.tsKeyInput, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
                value={whisperApiKey}
                onChangeText={setWhisperApiKey}
                placeholder="sk-... (OpenAI API key)"
                placeholderTextColor={theme.colors.onSurfaceVariant}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <TextInput
                style={[styles.tsKeyInput, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
                value={whisperEndpoint}
                onChangeText={setWhisperEndpoint}
                placeholder={DEFAULT_WHISPER_ENDPOINT}
                placeholderTextColor={theme.colors.onSurfaceVariant}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Button mode="outlined" onPress={saveWhisperSettings}>
                {whisperSaved ? 'Saved' : 'Save'}
              </Button>
            </>
          )}
        </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: { paddingBottom: 40 },
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
    fontSize: 11, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4,
  },
  sectionSubtitle: { fontSize: 13, lineHeight: 18 },
  topicRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4,
  },
  topicBox: {
    flex: 1, borderRadius: 8, borderWidth: 1, padding: 12,
  },
  topicLabel: {
    fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4,
  },
  topicValue: { fontFamily: 'Menlo', fontSize: 12 },
  serverRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  serverLabel: { fontSize: 11, fontWeight: '600', width: 48 },
  serverValue: { fontSize: 12, fontFamily: 'Menlo', flex: 1 },
  tsKeyRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  tsKeyInput: {
    flex: 1, borderRadius: 8, borderWidth: 1,
    padding: 12, fontSize: 13, fontFamily: 'Menlo',
  },
  recognizerRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 8, borderWidth: 1, padding: 12,
  },
  recognizerInfo: { flex: 1 },
  recognizerLabel: {
    fontSize: 10, fontWeight: '700',
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3,
  },
  recognizerValue: { fontSize: 13 },
});
