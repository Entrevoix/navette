// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { SkillInfo } from '../hooks/useNavettedWS';

interface SkillsScreenProps {
  visible: boolean;
  onClose: () => void;
  skills: SkillInfo[];
  onRefresh: () => void;
  onRun: (prompt: string) => void;
}

export function SkillsScreen({ visible, onClose, skills, onRefresh, onRun }: SkillsScreenProps) {
  const [search, setSearch] = useState('');
  const [selectedSkill, setSelectedSkill] = useState<SkillInfo | null>(null);

  const handleRun = (skill: SkillInfo) => {
    try {
      onRun(`/${skill.name}`);
      setSelectedSkill(null);
      onClose();
    } catch {
      Alert.alert('Error', `Failed to launch skill "${skill.name}".`);
    }
  };

  useEffect(() => {
    if (visible) {
      onRefresh();
      setSearch('');
      setSelectedSkill(null);
    }
  }, [visible, onRefresh]);

  const filtered = useMemo(() => {
    const sorted = [...skills].sort((a, b) => a.name.localeCompare(b.name));
    if (!search.trim()) return sorted;
    const q = search.toLowerCase();
    return sorted.filter(
      s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
    );
  }, [skills, search]);

  const handleWebSearch = (skill: SkillInfo) => {
    const url = `https://www.google.com/search?q=claude+code+skill+${encodeURIComponent(skill.name)}`;
    Linking.openURL(url);
  };

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

        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search skills..."
            placeholderTextColor="#52525b"
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📂</Text>
            <Text style={styles.emptyText}>
              {search ? 'No skills match your search' : 'No skills found in ~/.claude/skills/'}
            </Text>
            {!search && (
              <Text style={styles.emptySubtext}>
                Skills are directories installed under ~/.claude/skills/ on the remote host.
              </Text>
            )}
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.name}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <Pressable
                style={styles.card}
                onPress={() => setSelectedSkill(item)}
              >
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
              </Pressable>
            )}
            ItemSeparatorComponent={() => <View style={styles.separator} />}
          />
        )}

        {/* Detail modal */}
        <Modal
          visible={!!selectedSkill}
          animationType="fade"
          transparent
          onRequestClose={() => setSelectedSkill(null)}
        >
          <Pressable style={styles.detailOverlay} onPress={() => setSelectedSkill(null)}>
            <View style={styles.detailCard} onStartShouldSetResponder={() => true}>
              <Text style={styles.detailName}>{selectedSkill?.name}</Text>
              <Text style={styles.detailDescription}>
                {selectedSkill?.description || 'No description available.'}
              </Text>
              <View style={styles.detailActions}>
                <Pressable
                  style={styles.detailRunBtn}
                  onPress={() => selectedSkill && handleRun(selectedSkill)}
                >
                  <Text style={styles.detailRunBtnText}>Run Skill</Text>
                </Pressable>
                <Pressable
                  style={styles.detailWebBtn}
                  onPress={() => selectedSkill && handleWebSearch(selectedSkill)}
                >
                  <Text style={styles.detailWebBtnText}>Search the web</Text>
                </Pressable>
              </View>
              <Pressable
                style={styles.detailCloseBtn}
                onPress={() => setSelectedSkill(null)}
              >
                <Text style={styles.detailCloseBtnText}>Close</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0f0f1a' },
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
  title: { color: '#f0f0f0', fontSize: 18, fontWeight: '700' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  refreshBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  refreshText: { color: '#818cf8', fontSize: 15, fontWeight: '600' },
  closeBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  closeText: { color: '#4ade80', fontSize: 15, fontWeight: '600' },
  searchRow: { paddingHorizontal: 16, paddingVertical: 10 },
  searchInput: {
    backgroundColor: '#1e1e2e',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f0f0f0',
    fontSize: 14,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
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
  cardIconText: { fontSize: 18 },
  cardBody: { flex: 1, gap: 4 },
  skillName: { color: '#f0f0f0', fontSize: 15, fontWeight: '700', fontFamily: 'Menlo' },
  skillDescription: { color: '#9ca3af', fontSize: 13, lineHeight: 18 },
  skillDescriptionEmpty: { color: '#3f3f5f', fontSize: 13, fontStyle: 'italic' },
  runBtn: {
    alignSelf: 'center',
    backgroundColor: '#4f46e5',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  runBtnPressed: { opacity: 0.7 },
  runBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  separator: { height: 8 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyText: { color: '#9ca3af', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptySubtext: { color: '#555', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  detailCard: {
    backgroundColor: '#1e1e2e',
    borderRadius: 14,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    gap: 16,
  },
  detailName: { color: '#f0f0f0', fontSize: 18, fontWeight: '700', fontFamily: 'Menlo' },
  detailDescription: { color: '#9ca3af', fontSize: 14, lineHeight: 20 },
  detailActions: { flexDirection: 'row', gap: 10 },
  detailRunBtn: {
    flex: 1,
    backgroundColor: '#4f46e5',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  detailRunBtnText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  detailWebBtn: {
    flex: 1,
    backgroundColor: '#2a2a3e',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  detailWebBtnText: { color: '#818cf8', fontSize: 14, fontWeight: '600' },
  detailCloseBtn: { alignItems: 'center', paddingVertical: 8 },
  detailCloseBtnText: { color: '#52525b', fontSize: 13 },
});
