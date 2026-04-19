import React, { useEffect } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { SkillInfo } from '../hooks/useClaudedWS';

interface SkillsScreenProps {
  visible: boolean;
  onClose: () => void;
  skills: SkillInfo[];
  onRefresh: () => void;
  onRun: (prompt: string) => void;
}

export function SkillsScreen({ visible, onClose, skills, onRefresh, onRun }: SkillsScreenProps) {
  const handleRun = (skill: SkillInfo) => {
    try {
      onRun(`/${skill.name}`);
      onClose();
    } catch {
      Alert.alert('Error', `Failed to launch skill "${skill.name}".`);
    }
  };
  useEffect(() => {
    if (visible) {
      onRefresh();
    }
  }, [visible, onRefresh]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Installed Skills</Text>
          <View style={styles.headerRight}>
            <Pressable onPress={onRefresh} hitSlop={12} style={styles.refreshBtn}>
              <Text style={styles.refreshText}>Refresh</Text>
            </Pressable>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Text style={styles.closeText}>Done</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.pathHint}>~/.claude/skills/</Text>

        {skills.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📂</Text>
            <Text style={styles.emptyText}>No skills found in ~/.claude/skills/</Text>
            <Text style={styles.emptySubtext}>
              Skills are directories installed under ~/.claude/skills/ on the remote host.
            </Text>
          </View>
        ) : (
          <FlatList
            data={skills}
            keyExtractor={(item) => item.name}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardIcon}>
                  <Text style={styles.cardIconText}>📦</Text>
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.skillName}>{item.name}</Text>
                  {item.description ? (
                    <Text style={styles.skillDescription} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : (
                    <Text style={styles.skillDescriptionEmpty}>No description</Text>
                  )}
                </View>
                <Pressable
                  onPress={() => handleRun(item)}
                  hitSlop={8}
                  style={({ pressed }) => [styles.runBtn, pressed && styles.runBtnPressed]}
                >
                  <Text style={styles.runBtnText}>Run</Text>
                </Pressable>
              </View>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f0f1a',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a2e',
  },
  title: {
    color: '#f0f0f0',
    fontSize: 18,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  refreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  refreshText: {
    color: '#818cf8',
    fontSize: 15,
    fontWeight: '600',
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
  pathHint: {
    color: '#444',
    fontSize: 11,
    fontFamily: 'Menlo',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1e1e2e',
    borderRadius: 10,
    padding: 16,
    gap: 12,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconText: {
    fontSize: 18,
  },
  cardBody: {
    flex: 1,
    gap: 4,
  },
  skillName: {
    color: '#f0f0f0',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'Menlo',
  },
  skillDescription: {
    color: '#9ca3af',
    fontSize: 13,
    lineHeight: 18,
  },
  skillDescriptionEmpty: {
    color: '#3f3f5f',
    fontSize: 13,
    fontStyle: 'italic',
  },
  runBtn: {
    alignSelf: 'center',
    backgroundColor: '#4f46e5',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  runBtnPressed: {
    opacity: 0.7,
  },
  runBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  separator: {
    height: 8,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: 8,
  },
  emptyText: {
    color: '#9ca3af',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  emptySubtext: {
    color: '#555',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
