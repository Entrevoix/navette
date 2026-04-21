// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { FileWriteResultEvent } from '../types';

interface ConfigEditorProps {
  path: string;
  initialContent: string;
  onSave: (path: string, content: string, cb: (ev: FileWriteResultEvent) => void) => void;
  onClose: () => void;
}

const MAX_EDITABLE_SIZE = 50 * 1024;

export function ConfigEditor({ path, initialContent, onSave, onClose }: ConfigEditorProps) {
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
      <View style={styles.container}>
        <View style={styles.header}>
          <Pressable onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Back</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>{filename}</Text>
          <View style={styles.placeholder} />
        </View>
        <View style={styles.center}>
          <Text style={styles.errorText}>File too large to edit ({Math.round(initialContent.length / 1024)}KB, max {MAX_EDITABLE_SIZE / 1024}KB)</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Pressable onPress={handleClose} style={styles.cancelBtn}>
          <Text style={styles.cancelText}>Cancel</Text>
        </Pressable>
        <Text style={styles.title} numberOfLines={1}>{filename}</Text>
        <Pressable
          onPress={handleSave}
          style={[styles.saveBtn, (!hasChanges || saving) && styles.saveBtnDisabled]}
          disabled={!hasChanges || saving}
        >
          <Text style={styles.saveBtnText}>{saving ? 'Saving...' : 'Save'}</Text>
        </Pressable>
      </View>
      {feedback && (
        <View style={[styles.feedbackBar, feedback === 'Saved' ? styles.feedbackOk : styles.feedbackErr]}>
          <Text style={styles.feedbackText}>{feedback}</Text>
        </View>
      )}
      <TextInput
        style={styles.editor}
        value={content}
        onChangeText={setContent}
        multiline
        autoCorrect={false}
        autoCapitalize="none"
        textAlignVertical="top"
        scrollEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  cancelBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  cancelText: { color: '#9ca3af', fontSize: 15 },
  title: { color: '#e2e8f0', fontSize: 15, fontWeight: '600', flex: 1, textAlign: 'center' },
  placeholder: { width: 60 },
  saveBtn: {
    backgroundColor: '#14532d',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  saveBtnDisabled: { opacity: 0.4 },
  saveBtnText: { color: '#4ade80', fontSize: 14, fontWeight: '700' },
  feedbackBar: {
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  feedbackOk: { backgroundColor: '#052e16' },
  feedbackErr: { backgroundColor: '#450a0a' },
  feedbackText: { color: '#e2e8f0', fontSize: 12, textAlign: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorText: { color: '#f87171', fontSize: 13, textAlign: 'center' },
  editor: {
    flex: 1,
    fontFamily: 'Menlo',
    fontSize: 12,
    color: '#d4d4d8',
    padding: 12,
    lineHeight: 18,
  },
});
