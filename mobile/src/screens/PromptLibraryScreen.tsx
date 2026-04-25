// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, IconButton, useTheme } from 'react-native-paper';
import type { SavedPrompt } from '../types';

interface PromptLibraryScreenProps {
  visible: boolean;
  onClose: () => void;
  prompts: SavedPrompt[];
  onRefresh: () => void;
  onUse: (body: string) => void;
  onSave: (title: string, body: string, tags?: string[]) => void;
  onUpdate: (id: string, title: string, body: string, tags?: string[]) => void;
  onDelete: (id: string) => void;
}

export function PromptLibraryScreen({
  visible, onClose, prompts, onRefresh, onUse, onSave, onUpdate, onDelete,
}: PromptLibraryScreenProps) {
  const theme = useTheme();
  const [editorVisible, setEditorVisible] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (visible) onRefresh();
  }, [visible, onRefresh]);

  const filtered = searchQuery.trim()
    ? prompts.filter(p =>
        p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.body.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : prompts;

  const openNew = () => {
    setEditingId(null);
    setTitle('');
    setBody('');
    setEditorVisible(true);
  };

  const openEdit = (prompt: SavedPrompt) => {
    setEditingId(prompt.id);
    setTitle(prompt.title);
    setBody(prompt.body);
    setEditorVisible(true);
  };

  const handleSave = () => {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) return;
    if (editingId) {
      onUpdate(editingId, t, b);
    } else {
      onSave(t, b);
    }
    setEditorVisible(false);
    setTitle('');
    setBody('');
    setEditingId(null);
  };

  const handleDelete = (prompt: SavedPrompt) => {
    Alert.alert('Delete prompt', `Delete "${prompt.title}"?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => onDelete(prompt.id) },
    ]);
  };

  const handleUse = (prompt: SavedPrompt) => {
    onUse(prompt.body);
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {/* Editor sub-modal */}
      <Modal visible={editorVisible} animationType="fade" transparent onRequestClose={() => setEditorVisible(false)}>
        <View style={styles.editorOverlay}>
          <View style={[styles.editorCard, { backgroundColor: theme.colors.surfaceVariant }]}>
            <Text style={[styles.editorTitle, { color: theme.colors.onSurface }]}>{editingId ? 'Edit Prompt' : 'New Prompt'}</Text>
            <TextInput
              style={[styles.editorInput, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
              value={title}
              onChangeText={setTitle}
              placeholder="Title"
              placeholderTextColor={theme.colors.onSurfaceVariant}
              autoFocus
            />
            <TextInput
              style={[styles.editorInput, styles.editorBody, { backgroundColor: theme.colors.surface, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
              value={body}
              onChangeText={(b: string) => setBody(b)}
              placeholder="Prompt body..."
              placeholderTextColor={theme.colors.onSurfaceVariant}
              multiline
              textAlignVertical="top"
            />
            <View style={styles.editorActions}>
              <Button mode="text" onPress={() => setEditorVisible(false)}>Cancel</Button>
              <Button
                mode="contained-tonal"
                onPress={handleSave}
                disabled={!title.trim() || !body.trim()}
              >
                Save
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.headerTitle, { color: theme.colors.onSurface }]}>Prompt Library</Text>
          <View style={styles.headerRight}>
            <Button mode="contained-tonal" compact onPress={openNew}>+ New</Button>
            <Button mode="text" onPress={onClose}>Done</Button>
          </View>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            style={[styles.searchInput, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search prompts..."
            placeholderTextColor={theme.colors.onSurfaceVariant}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📝</Text>
            <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>
              {prompts.length === 0 ? 'No saved prompts yet' : 'No matching prompts'}
            </Text>
            <Text style={[styles.emptySubtext, { color: theme.colors.onSurfaceVariant }]}>
              {prompts.length === 0
                ? 'Tap "+ New" to create your first prompt template.'
                : 'Try a different search term.'}
            </Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={[styles.card, { backgroundColor: theme.colors.surfaceVariant }]}>
                <Pressable style={styles.cardBody} onPress={() => handleUse(item)}>
                  <Text style={[styles.promptTitle, { color: theme.colors.onSurface }]}>{item.title}</Text>
                  <Text style={[styles.promptBody, { color: theme.colors.onSurfaceVariant }]} numberOfLines={2}>{item.body}</Text>
                  {item.tags.length > 0 && (
                    <View style={styles.tagsRow}>
                      {item.tags.map(tag => (
                        <View key={tag} style={[styles.tag, { backgroundColor: theme.colors.surface }]}>
                          <Text style={[styles.tagText, { color: theme.colors.primary }]}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </Pressable>
                <View style={styles.cardActions}>
                  <Button
                    mode="contained-tonal"
                    compact
                    onPress={() => handleUse(item)}
                  >
                    Use
                  </Button>
                  <Button mode="text" compact onPress={() => openEdit(item)}>Edit</Button>
                  <IconButton icon="delete" size={18} iconColor={theme.colors.error} onPress={() => handleDelete(item)} />
                </View>
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
  container: { flex: 1 },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
    borderBottomWidth: 1,
  },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  searchRow: { paddingHorizontal: 16, paddingVertical: 10 },
  searchInput: {
    borderRadius: 8, borderWidth: 1,
    padding: 10, fontSize: 14,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    flexDirection: 'row', alignItems: 'flex-start',
    borderRadius: 10, padding: 16, gap: 12,
  },
  cardBody: { flex: 1, gap: 6 },
  promptTitle: { fontSize: 15, fontWeight: '700' },
  promptBody: { fontSize: 13, lineHeight: 18 },
  tagsRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  tag: { borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { fontSize: 11, fontWeight: '600' },
  cardActions: { gap: 4, alignItems: 'center' },
  separator: { height: 8 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyText: { fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptySubtext: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  editorOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', paddingHorizontal: 20,
  },
  editorCard: {
    borderRadius: 12, padding: 20, gap: 12,
  },
  editorTitle: { fontSize: 16, fontWeight: '700' },
  editorInput: {
    borderRadius: 8, borderWidth: 1,
    padding: 12, fontSize: 14,
  },
  editorBody: { minHeight: 120, textAlignVertical: 'top' },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 4 },
});
