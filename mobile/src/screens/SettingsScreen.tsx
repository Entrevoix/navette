import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import React, { useEffect, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { DEFAULT_WHISPER_ENDPOINT, STT_ENGINE_KEY, STT_RECOGNIZER_LABEL_KEY, STT_RECOGNIZER_PKG_KEY, WHISPER_API_KEY_STORAGE, WHISPER_ENDPOINT_KEY } from '../components/VoiceButton';
import { ScheduleScreen } from './ScheduleScreen';
import { SessionHistoryScreen } from './SessionHistoryScreen';
import { SkillsScreen } from './SkillsScreen';
import type { SkillInfo } from '../hooks/useClaudedWS';
import type { EventFrame, PastSessionInfo, ScheduledSessionInfo } from '../types';

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
  scheduledSessions: ScheduledSessionInfo[];
  onScheduleSession: (prompt: string, scheduledAt: number) => void;
  onCancelScheduledSession: (id: string) => void;
  onListScheduledSessions: () => void;
}

export function SettingsScreen({ visible, onClose, notifyConfig, onRequestNotifyConfig, onSendTestNotification, testNotificationResult, skills, onListSkills, onRunSkill, pastSessions, sessionHistory, onListPastSessions, onGetSessionHistory, scheduledSessions, onScheduleSession, onCancelScheduledSession, onListScheduledSessions }: SettingsScreenProps) {
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
      <SessionHistoryScreen
        visible={historyVisible}
        onClose={() => setHistoryVisible(false)}
        pastSessions={pastSessions}
        sessionHistory={sessionHistory}
        onListPastSessions={onListPastSessions}
        onGetSessionHistory={onGetSessionHistory}
      />
      <SkillsScreen
        visible={skillsVisible}
        onClose={() => setSkillsVisible(false)}
        skills={skills}
        onRefresh={onListSkills}
        onRun={onRunSkill}
      />
      <ScheduleScreen
        visible={scheduleVisible}
        onClose={() => setScheduleVisible(false)}
        scheduledSessions={scheduledSessions}
        onSchedule={onScheduleSession}
        onCancel={onCancelScheduledSession}
        onRefresh={onListScheduledSessions}
      />
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Settings</Text>
          <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Push Notifications</Text>
          <Text style={styles.sectionSubtitle}>
            Install the ntfy app and subscribe to your topic to receive approval alerts and session updates.
          </Text>

          <View style={styles.topicRow}>
            <View style={styles.topicBox}>
              <Text style={styles.topicLabel}>Topic</Text>
              <Text style={styles.topicValue} selectable>
                {notifyConfig?.topic ?? '—'}
              </Text>
            </View>
            <Pressable
              style={[styles.copyBtn, copied && styles.copyBtnDone]}
              onPress={handleCopy}
              disabled={!notifyConfig?.topic}
            >
              <Text style={styles.copyBtnText}>{copied ? 'Copied' : 'Copy'}</Text>
            </Pressable>
          </View>

          {notifyConfig?.base_url && notifyConfig.base_url !== 'https://ntfy.sh' && (
            <View style={styles.serverRow}>
              <Text style={styles.serverLabel}>Server</Text>
              <Text style={styles.serverValue} selectable>{notifyConfig.base_url}</Text>
            </View>
          )}

          <Pressable
            style={[styles.subscribeBtn, !notifyConfig?.topic && styles.subscribeBtnDisabled]}
            onPress={handleSubscribe}
            disabled={!notifyConfig?.topic}
          >
            <Text style={styles.subscribeBtnText}>Open in ntfy app →</Text>
          </Pressable>

          <Pressable
            style={[styles.testBtn, !notifyConfig?.topic && styles.subscribeBtnDisabled]}
            onPress={onSendTestNotification}
            disabled={!notifyConfig?.topic}
          >
            <Text style={styles.testBtnText}>
              {testFeedback === 'sent' ? '✓ Sent' : testFeedback === 'failed' ? '✗ Failed' : 'Send test notification'}
            </Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Tailscale</Text>
          <Text style={styles.sectionSubtitle}>
            Optional. Add an API key to browse your Tailscale peers from the connect screen.
            Generate one at tailscale.com → Settings → Keys.
          </Text>
          <View style={styles.tsKeyRow}>
            <TextInput
              style={[styles.tsKeyInput]}
              value={tsApiKey}
              onChangeText={setTsApiKey}
              placeholder="tskey-api-..."
              placeholderTextColor="#444"
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
            />
            <Pressable
              style={[styles.tsKeySaveBtn, tsKeySaved && styles.tsKeySaveBtnDone]}
              onPress={saveTsKey}
            >
              <Text style={styles.tsKeySaveBtnText}>{tsKeySaved ? 'Saved' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Session History</Text>
          <Text style={styles.sectionSubtitle}>
            Browse and replay completed past sessions stored on the server.
          </Text>
          <Pressable style={styles.historyBtn} onPress={() => setHistoryVisible(true)}>
            <Text style={styles.historyBtnText}>View Session History →</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Skills</Text>
          <Text style={styles.sectionSubtitle}>
            Browse skills installed on the remote host in ~/.claude/skills/.
          </Text>
          <Pressable style={styles.skillsBtn} onPress={() => setSkillsVisible(true)}>
            <Text style={styles.skillsBtnText}>
              Browse Skills ({skills.length}) →
            </Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Scheduled Sessions</Text>
          <Text style={styles.sectionSubtitle}>
            Schedule a Claude session to start at a future time.
          </Text>
          <Pressable style={styles.scheduleBtn} onPress={() => setScheduleVisible(true)}>
            <Text style={styles.scheduleBtnText}>
              Manage Scheduled ({scheduledSessions.filter(s => !s.fired).length} pending) →
            </Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Voice Input</Text>
          <Text style={styles.sectionSubtitle}>
            On-device uses Android's built-in recognizer. Whisper API sends audio to OpenAI (or a compatible endpoint) for transcription.
          </Text>

          <View style={styles.enginePicker}>
            <Pressable
              style={[styles.engineOption, sttEngine === 'ondevice' && styles.engineOptionActive]}
              onPress={() => handleEngineChange('ondevice')}
            >
              <Text style={[styles.engineOptionText, sttEngine === 'ondevice' && styles.engineOptionTextActive]}>
                On-device
              </Text>
            </Pressable>
            <Pressable
              style={[styles.engineOption, sttEngine === 'whisper' && styles.engineOptionActive]}
              onPress={() => handleEngineChange('whisper')}
            >
              <Text style={[styles.engineOptionText, sttEngine === 'whisper' && styles.engineOptionTextActive]}>
                Whisper API
              </Text>
            </Pressable>
          </View>

          {sttEngine === 'ondevice' && (
            <View style={styles.recognizerRow}>
              <View style={styles.recognizerInfo}>
                <Text style={styles.recognizerLabel}>Recognizer</Text>
                <Text style={styles.recognizerValue}>
                  {recognizerLabel ?? 'Auto-detect on next tap'}
                </Text>
              </View>
              {recognizerLabel && (
                <Pressable style={styles.resetBtn} onPress={resetRecognizer}>
                  <Text style={styles.resetBtnText}>Reset</Text>
                </Pressable>
              )}
            </View>
          )}

          {sttEngine === 'whisper' && (
            <>
              <TextInput
                style={styles.tsKeyInput}
                value={whisperApiKey}
                onChangeText={setWhisperApiKey}
                placeholder="sk-... (OpenAI API key)"
                placeholderTextColor="#444"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <TextInput
                style={styles.tsKeyInput}
                value={whisperEndpoint}
                onChangeText={setWhisperEndpoint}
                placeholder={DEFAULT_WHISPER_ENDPOINT}
                placeholderTextColor="#444"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Pressable
                style={[styles.tsKeySaveBtn, whisperSaved && styles.tsKeySaveBtnDone]}
                onPress={saveWhisperSettings}
              >
                <Text style={styles.tsKeySaveBtnText}>{whisperSaved ? 'Saved ✓' : 'Save'}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
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
  title: {
    color: '#f0f0f0',
    fontSize: 18,
    fontWeight: '700',
  },
  closeBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  closeText: {
    color: '#4ade80',
    fontSize: 15,
    fontWeight: '600',
  },
  section: {
    padding: 20,
    gap: 12,
  },
  sectionLabel: {
    color: '#888',
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: 4,
  },
  sectionSubtitle: {
    color: '#555',
    fontSize: 13,
    lineHeight: 18,
  },
  topicRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 4,
  },
  topicBox: {
    flex: 1,
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 12,
  },
  topicLabel: {
    color: '#444',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  topicValue: {
    color: '#93c5fd',
    fontFamily: 'Menlo',
    fontSize: 12,
  },
  copyBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    backgroundColor: '#111',
  },
  copyBtnDone: {
    borderColor: '#166534',
    backgroundColor: '#052e16',
  },
  copyBtnText: {
    color: '#888',
    fontSize: 13,
    fontWeight: '600',
  },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  serverLabel: {
    color: '#444',
    fontSize: 11,
    fontWeight: '600',
    width: 48,
  },
  serverValue: {
    color: '#555',
    fontSize: 12,
    fontFamily: 'Menlo',
    flex: 1,
  },
  subscribeBtn: {
    backgroundColor: '#1e3a5f',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  subscribeBtnDisabled: {
    opacity: 0.35,
  },
  subscribeBtnText: {
    color: '#93c5fd',
    fontSize: 15,
    fontWeight: '700',
  },
  testBtn: {
    backgroundColor: '#111',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  testBtnText: {
    color: '#888',
    fontSize: 15,
    fontWeight: '600',
  },
  historyBtn: {
    backgroundColor: '#0d1a2e',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1e3a5f',
    marginTop: 4,
  },
  historyBtnText: {
    color: '#93c5fd',
    fontSize: 15,
    fontWeight: '700',
  },
  skillsBtn: {
    backgroundColor: '#1e1b4b',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#3730a3',
    marginTop: 4,
  },
  skillsBtnText: {
    color: '#a5b4fc',
    fontSize: 15,
    fontWeight: '700',
  },
  scheduleBtn: {
    backgroundColor: '#0d1a0d',
    borderRadius: 8,
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#166534',
    marginTop: 4,
  },
  scheduleBtnText: {
    color: '#4ade80',
    fontSize: 15,
    fontWeight: '700',
  },
  tsKeyRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  tsKeyInput: {
    flex: 1, backgroundColor: '#0d0d0d', borderRadius: 8, borderWidth: 1,
    borderColor: '#2a2a2a', padding: 12, color: '#f0f0f0', fontSize: 13,
    fontFamily: 'Menlo',
  },
  tsKeySaveBtn: {
    paddingHorizontal: 14, paddingVertical: 12, borderRadius: 8,
    borderWidth: 1, borderColor: '#2a2a2a', backgroundColor: '#111',
  },
  tsKeySaveBtnDone: { borderColor: '#166534', backgroundColor: '#052e16' },
  tsKeySaveBtnText: { color: '#888', fontSize: 13, fontWeight: '600' },
  enginePicker: {
    flexDirection: 'row',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    overflow: 'hidden',
  },
  engineOption: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#0d0d0d',
  },
  engineOptionActive: {
    backgroundColor: '#1a1a1a',
    borderBottomWidth: 2,
    borderBottomColor: '#4ade80',
  },
  engineOptionText: {
    color: '#555',
    fontSize: 13,
    fontWeight: '600',
  },
  engineOptionTextActive: {
    color: '#f0f0f0',
  },
  recognizerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#0d0d0d',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    padding: 12,
  },
  recognizerInfo: { flex: 1 },
  recognizerLabel: {
    color: '#444',
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 3,
  },
  recognizerValue: {
    color: '#f0f0f0',
    fontSize: 13,
  },
  resetBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#3a1a1a',
    backgroundColor: '#1a0a0a',
  },
  resetBtnText: {
    color: '#DA7756',
    fontSize: 12,
    fontWeight: '600',
  },
});
