// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { ApprovalPolicy, PolicyAction } from '../types';

const COMMON_TOOLS = [
  'Read', 'Write', 'Edit', 'MultiEdit',
  'Bash', 'Glob', 'Grep', 'LS',
  'WebSearch', 'TodoRead', 'TodoWrite',
  'NotebookRead', 'NotebookEdit',
];

interface Props {
  visible: boolean;
  onClose: () => void;
  policies: ApprovalPolicy[];
  onRefresh: () => void;
  onSet: (tool_name: string, action: PolicyAction) => void;
  onDelete: (tool_name: string) => void;
}

function getPolicyAction(policies: ApprovalPolicy[], tool: string): PolicyAction {
  const entry = policies.find(p => p.tool_name === tool);
  return entry?.action ?? 'prompt';
}

function cycleAction(current: PolicyAction): PolicyAction {
  if (current === 'allow') return 'prompt';
  if (current === 'prompt') return 'deny';
  return 'allow';
}

function badgeColor(action: PolicyAction) {
  if (action === 'allow') return { bg: '#166534', text: '#4ade80' };
  if (action === 'deny') return { bg: '#3a1a1a', text: '#f87171' };
  return { bg: '#1a1500', text: '#fbbf24' };
}

function badgeLabel(action: PolicyAction) {
  if (action === 'allow') return 'Auto-Allow';
  if (action === 'deny') return 'Auto-Deny';
  return 'Ask me';
}

export function ApprovalPolicyScreen({ visible, onClose, policies, onRefresh, onSet, onDelete }: Props) {
  const [customTool, setCustomTool] = useState('');

  useEffect(() => {
    if (visible) onRefresh();
  }, [visible, onRefresh]);

  const handleTap = (tool: string) => {
    const current = getPolicyAction(policies, tool);
    const next = cycleAction(current);
    if (next === 'prompt') {
      onDelete(tool);
    } else {
      onSet(tool, next);
    }
  };

  const handleAddCustom = () => {
    if (!customTool.trim()) return;
    onSet(customTool.trim(), 'allow');
    setCustomTool('');
  };

  const customPolicies = policies.filter(p => !COMMON_TOOLS.includes(p.tool_name));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Approval Policies</Text>
          <Pressable onPress={onClose}>
            <Text style={styles.doneBtn}>Done</Text>
          </Pressable>
        </View>
        <Text style={styles.hint}>
          Tap to cycle: Auto-Allow → Ask me → Auto-Deny. Keep Bash, Write, and Edit set to Ask.
        </Text>
        <FlatList
          data={[...COMMON_TOOLS, ...customPolicies.map(p => p.tool_name)]}
          keyExtractor={item => item}
          renderItem={({ item }) => {
            const action = getPolicyAction(policies, item);
            const colors = badgeColor(action);
            return (
              <Pressable style={styles.row} onPress={() => handleTap(item)}>
                <Text style={styles.toolName}>{item}</Text>
                <View style={[styles.badge, { backgroundColor: colors.bg }]}>
                  <Text style={[styles.badgeText, { color: colors.text }]}>
                    {badgeLabel(action)}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ListFooterComponent={
            <View style={styles.addSection}>
              <Text style={styles.sectionLabel}>Custom Tool Rule</Text>
              <View style={styles.addRow}>
                <TextInput
                  style={styles.input}
                  placeholder="Tool name"
                  placeholderTextColor="#555"
                  value={customTool}
                  onChangeText={setCustomTool}
                  autoCapitalize="none"
                />
                <Pressable
                  style={[styles.addBtn, !customTool.trim() && styles.addBtnDisabled]}
                  onPress={handleAddCustom}
                  disabled={!customTool.trim()}
                >
                  <Text style={styles.addBtnText}>Add</Text>
                </Pressable>
              </View>
            </View>
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', paddingTop: 60 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  title: { color: '#f0f0f0', fontSize: 20, fontWeight: '700' },
  doneBtn: { color: '#60a5fa', fontSize: 16, fontWeight: '600' },
  hint: { color: '#888', fontSize: 13, paddingHorizontal: 20, marginBottom: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#1a1a1a',
  },
  toolName: { color: '#f0f0f0', fontSize: 15 },
  badge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 13, fontWeight: '600' },
  addSection: { paddingHorizontal: 20, paddingTop: 24 },
  sectionLabel: { color: '#888', fontSize: 13, fontWeight: '600', marginBottom: 8 },
  addRow: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    color: '#f0f0f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  addBtn: {
    backgroundColor: '#1a3a2a',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    justifyContent: 'center',
  },
  addBtnDisabled: { opacity: 0.4 },
  addBtnText: { color: '#4ade80', fontWeight: '600', fontSize: 15 },
});
