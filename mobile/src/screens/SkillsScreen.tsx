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
import { Button, useTheme } from 'react-native-paper';
import type { SkillInfo } from '../hooks/useNavettedWS';

interface SkillsScreenProps {
  visible: boolean;
  onClose: () => void;
  skills: SkillInfo[];
  onRefresh: () => void;
  onRun: (prompt: string) => void;
}

export function SkillsScreen({ visible, onClose, skills, onRefresh, onRun }: SkillsScreenProps) {
  const theme = useTheme();
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
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>Installed Skills</Text>
          <View style={styles.headerRight}>
            <Button mode="text" onPress={onRefresh}>Refresh</Button>
            <Button mode="text" onPress={onClose}>Done</Button>
          </View>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            style={[styles.searchInput, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
            value={search}
            onChangeText={setSearch}
            placeholder="Search skills..."
            placeholderTextColor={theme.colors.onSurfaceVariant}
            autoCorrect={false}
            autoCapitalize="none"
          />
        </View>

        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📂</Text>
            <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>
              {search ? 'No skills match your search' : 'No skills found in ~/.claude/skills/'}
            </Text>
            {!search && (
              <Text style={[styles.emptySubtext, { color: theme.colors.onSurfaceVariant }]}>
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
                style={[styles.card, { backgroundColor: theme.colors.surfaceVariant }]}
                onPress={() => setSelectedSkill(item)}
              >
                <View style={[styles.cardIcon, { backgroundColor: theme.colors.surface }]}>
                  <Text style={styles.cardIconText}>📦</Text>
                </View>
                <View style={styles.cardBody}>
                  <Text style={[styles.skillName, { color: theme.colors.onSurface }]}>{item.name}</Text>
                  {item.description ? (
                    <Text style={[styles.skillDescription, { color: theme.colors.onSurfaceVariant }]} numberOfLines={2}>
                      {item.description}
                    </Text>
                  ) : (
                    <Text style={[styles.skillDescriptionEmpty, { color: theme.colors.onSurfaceVariant }]}>No description</Text>
                  )}
                </View>
                <Button
                  mode="contained-tonal"
                  compact
                  onPress={() => handleRun(item)}
                >
                  Run
                </Button>
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
            <View style={[styles.detailCard, { backgroundColor: theme.colors.surfaceVariant }]} onStartShouldSetResponder={() => true}>
              <Text style={[styles.detailName, { color: theme.colors.onSurface }]}>{selectedSkill?.name}</Text>
              <Text style={[styles.detailDescription, { color: theme.colors.onSurfaceVariant }]}>
                {selectedSkill?.description || 'No description available.'}
              </Text>
              <View style={styles.detailActions}>
                <Button
                  mode="contained-tonal"
                  style={{ flex: 1 }}
                  onPress={() => selectedSkill && handleRun(selectedSkill)}
                >
                  Run Skill
                </Button>
                <Button
                  mode="outlined"
                  style={{ flex: 1 }}
                  onPress={() => selectedSkill && handleWebSearch(selectedSkill)}
                >
                  Search the web
                </Button>
              </View>
              <Button
                mode="text"
                onPress={() => setSelectedSkill(null)}
                style={styles.detailCloseBtn}
              >
                Close
              </Button>
            </View>
          </Pressable>
        </Modal>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
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
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  searchRow: { paddingHorizontal: 16, paddingVertical: 10 },
  searchInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 10,
    padding: 16,
    gap: 12,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconText: { fontSize: 18 },
  cardBody: { flex: 1, gap: 4 },
  skillName: { fontSize: 15, fontWeight: '700', fontFamily: 'Menlo' },
  skillDescription: { fontSize: 13, lineHeight: 18 },
  skillDescriptionEmpty: { fontSize: 13, fontStyle: 'italic' },
  separator: { height: 8 },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 40,
    gap: 12,
  },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptySubtext: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  detailCard: {
    borderRadius: 14,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    gap: 16,
  },
  detailName: { fontSize: 18, fontWeight: '700', fontFamily: 'Menlo' },
  detailDescription: { fontSize: 14, lineHeight: 20 },
  detailActions: { flexDirection: 'row', gap: 10 },
  detailCloseBtn: { alignSelf: 'center' },
});
