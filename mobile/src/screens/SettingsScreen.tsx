import React, { useEffect, useState } from 'react';
import {
  Clipboard,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

interface NotifyConfig {
  topic: string;
  base_url: string;
}

interface SettingsScreenProps {
  visible: boolean;
  onClose: () => void;
  notifyConfig: NotifyConfig | null;
  onRequestNotifyConfig: () => void;
}

export function SettingsScreen({ visible, onClose, notifyConfig, onRequestNotifyConfig }: SettingsScreenProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (visible) {
      onRequestNotifyConfig();
    }
  }, [visible, onRequestNotifyConfig]);

  const handleCopy = () => {
    if (!notifyConfig?.topic) return;
    Clipboard.setString(notifyConfig.topic);
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
});
