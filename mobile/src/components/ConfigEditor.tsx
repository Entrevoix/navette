// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTheme } from 'react-native-paper';
import type { FileWriteResultEvent } from '../types';

interface ConfigEditorProps {
  path: string;
  initialContent: string;
  onSave: (path: string, content: string, cb: (ev: FileWriteResultEvent) => void) => void;
  onClose: () => void;
}

const MAX_EDITABLE_SIZE = 50 * 1024;

export function ConfigEditor({ path, initialContent, onSave, onClose }: ConfigEditorProps) {
  const theme = useTheme();
  const [content, setContent] = useState(initialContent);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => { setContent(initialContent); }, [initialContent]);

  const hasChanges = content !== initialContent;
  const tooLarge = initialContent.length > MAX_EDITABLE_SIZE;
  const filename = path.split('/').pop() ?? path;

  const handleSave = () => {
    setSaving(true);
    setFeedback(null);
    onSave(path, content, (ev) => {
      setSaving(false);
      if (ev.ok) {
        setFeedback('Saved');
        setTimeout(() => setFeedback(null), 2000);
      } else {
        setFeedback(ev.error ?? 'Save failed');
      }
    });
  };

  const handleClose = () => {
    if (hasChanges) {
      Alert.alert('Unsaved changes', 'Discard changes?', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: onClose },
      ]);
    } else {
      onClose();
    }
  };

  if (tooLarge) {
    return (
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={[styles.cancelText, { color: theme.colors.onSurfaceVariant }]}>Back</Text>
          </Pressable>
          <Text style={[styles.title, { color: theme.colors.onSurface }]} numberOfLines={1}>{filename}</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.center}>
          <Text style={[styles.errorText, { color: theme.colors.error }]}>File too large to edit ({Math.round(initialContent.length / 1024)}KB, max {MAX_EDITABLE_SIZE / 1024}KB)</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
      <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
        <Pressable onPress={handleClose} style={styles.cancelBtn}>
          <Text style={[styles.cancelText, { color: theme.colors.onSurfaceVariant }]}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: theme.colors.onSurface }]} numberOfLines={1}>{filename}</Text>
        <Pressable
          onPress={handleSave}
          style={[styles.saveBtn, { backgroundColor: theme.colors.primaryContainer }, (!hasChanges || saving) && styles.saveBtnDisabled]}
          disabled={!hasChanges || saving}
        >
          <Text style={[styles.saveBtnText, { color: theme.colors.primary }]}>{saving ? 'Saving...' : 'Save'}</Text>
        </Pressable>
      </View>
      {feedback && (
        <View style={[
          styles.feedbackBar,
          feedback === 'Saved'
            ? { backgroundColor: theme.colors.primaryContainer }
            : { backgroundColor: theme.colors.errorContainer },
        ]}>
          <Text style={[styles.feedbackText, { color: theme.colors.onSurface }]}>{feedback}</Text>
        </View>
      )}
      <TextInput
        style={[styles.editor, { backgroundColor: theme.colors.surface, color: theme.colors.onSurface }]}
        value={content}
        onChangeText={setContent}
        multiline
        autoCorrect={false}
        autoCapitalize="none"
        textAlignVertical="top"
        scrollEnabled
        placeholderTextColor={theme.colors.onSurfaceVariant}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  cancelBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  cancelText: { fontSize: 15 },
  title: { fontSize: 15, fontWeight: '600', flex: 1, textAlign: 'center' },
  placeholder: { width: 60 },
  saveBtn: {
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { fontSize: 14, fontWeight: '700' },
  feedbackBar: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  feedbackText: { fontSize: 12, textAlign: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { fontSize: 13, textAlign: 'center' },
  editor: {
    flex: 1,
    fontFamily: 'Menlo',
    fontSize: 12,
    padding: 12,
    lineHeight: 18,
  },
});
