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
          <View style={styles.editorCard}>
            <Text style={styles.editorTitle}>{editingId ? 'Edit Prompt' : 'New Prompt'}</Text>
            <TextInput
              style={styles.editorInput}
              value={title}
              onChangeText={setTitle}
              placeholder="Title"
              placeholderTextColor="#555"
              autoFocus
            />
            <TextInput
              style={[styles.editorInput, styles.editorBody]}
              value={body}
              onChangeText={setBody}
              placeholder="Prompt body..."
              placeholderTextColor="#555"
              multiline
              textAlignVertical="top"
            />
            <View style={styles.editorActions}>
              <Pressable style={styles.editorCancel} onPress={() => setEditorVisible(false)}>
                <Text style={styles.editorCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                style={[styles.editorSave, (!title.trim() || !body.trim()) && styles.editorSaveDisabled]}
                onPress={handleSave}
                disabled={!title.trim() || !body.trim()}
              >
                <Text style={styles.editorSaveText}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Prompt Library</Text>
          <View style={styles.headerRight}>
            <Pressable onPress={openNew} hitSlop={12} style={styles.addBtn}>
              <Text style={styles.addBtnText}>+ New</Text>
            </Pressable>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Text style={styles.closeText}>Done</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.searchRow}>
          <TextInput
            style={styles.searchInput}
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Search prompts..."
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📝</Text>
            <Text style={styles.emptyText}>
              {prompts.length === 0 ? 'No saved prompts yet' : 'No matching prompts'}
            </Text>
            <Text style={styles.emptySubtext}>
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
              <View style={styles.card}>
                <Pressable style={styles.cardBody} onPress={() => handleUse(item)}>
                  <Text style={styles.promptTitle}>{item.title}</Text>
                  <Text style={styles.promptBody} numberOfLines={2}>{item.body}</Text>
                  {item.tags.length > 0 && (
                    <View style={styles.tagsRow}>
                      {item.tags.map(tag => (
                        <View key={tag} style={styles.tag}>
                          <Text style={styles.tagText}>{tag}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </Pressable>
                <View style={styles.cardActions}>
                  <Pressable
                    onPress={() => handleUse(item)}
                    hitSlop={8}
                    style={({ pressed }) => [styles.useBtn, pressed && styles.useBtnPressed]}
                  >
                    <Text style={styles.useBtnText}>Use</Text>
                  </Pressable>
                  <Pressable onPress={() => openEdit(item)} hitSlop={8} style={styles.editBtn}>
                    <Text style={styles.editBtnText}>Edit</Text>
                  </Pressable>
                  <Pressable onPress={() => handleDelete(item)} hitSlop={8} style={styles.deleteBtn}>
                    <Text style={styles.deleteBtnText}>×</Text>
                  </Pressable>
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
  container: { flex: 1, backgroundColor: '#0f0f1a' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#1a1a2e',
  },
  headerTitle: { color: '#f0f0f0', fontSize: 18, fontWeight: '700' },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  addBtn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#4f46e5', borderRadius: 6 },
  addBtnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  closeBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  closeText: { color: '#4ade80', fontSize: 15, fontWeight: '600' },
  searchRow: { paddingHorizontal: 16, paddingVertical: 10 },
  searchInput: {
    backgroundColor: '#1e1e2e', borderRadius: 8, borderWidth: 1, borderColor: '#2a2a3e',
    padding: 10, color: '#f0f0f0', fontSize: 14,
  },
  listContent: { paddingHorizontal: 16, paddingBottom: 24 },
  card: {
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: '#1e1e2e', borderRadius: 10, padding: 16, gap: 12,
  },
  cardBody: { flex: 1, gap: 6 },
  promptTitle: { color: '#f0f0f0', fontSize: 15, fontWeight: '700' },
  promptBody: { color: '#9ca3af', fontSize: 13, lineHeight: 18 },
  tagsRow: { flexDirection: 'row', gap: 6, marginTop: 4 },
  tag: { backgroundColor: '#2a2a3e', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 },
  tagText: { color: '#818cf8', fontSize: 11, fontWeight: '600' },
  cardActions: { gap: 8, alignItems: 'center' },
  useBtn: { backgroundColor: '#4f46e5', borderRadius: 6, paddingHorizontal: 12, paddingVertical: 6 },
  useBtnPressed: { opacity: 0.7 },
  useBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  editBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  editBtnText: { color: '#818cf8', fontSize: 12, fontWeight: '600' },
  deleteBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  deleteBtnText: { color: '#f87171', fontSize: 16, fontWeight: '700' },
  separator: { height: 8 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 40, gap: 12 },
  emptyIcon: { fontSize: 48, marginBottom: 8 },
  emptyText: { color: '#9ca3af', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  emptySubtext: { color: '#555', fontSize: 13, lineHeight: 18, textAlign: 'center' },
  editorOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', paddingHorizontal: 20,
  },
  editorCard: {
    backgroundColor: '#1e1e2e', borderRadius: 12, padding: 20, gap: 12,
  },
  editorTitle: { color: '#f0f0f0', fontSize: 16, fontWeight: '700' },
  editorInput: {
    backgroundColor: '#0f0f1a', borderRadius: 8, borderWidth: 1, borderColor: '#2a2a3e',
    padding: 12, color: '#f0f0f0', fontSize: 14,
  },
  editorBody: { minHeight: 120, textAlignVertical: 'top' },
  editorActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 4 },
  editorCancel: { paddingHorizontal: 16, paddingVertical: 10 },
  editorCancelText: { color: '#9ca3af', fontSize: 14, fontWeight: '600' },
  editorSave: { backgroundColor: '#4f46e5', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  editorSaveDisabled: { opacity: 0.35 },
  editorSaveText: { color: '#fff', fontSize: 14, fontWeight: '700' },
});
