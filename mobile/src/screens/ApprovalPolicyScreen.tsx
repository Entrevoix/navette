// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Button, useTheme } from 'react-native-paper';
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
  if (current === 'prompt') return 'allow';
  if (current === 'allow') return 'deny';
  return 'prompt';
}

function badgeLabel(action: PolicyAction): string {
  if (action === 'allow') return 'Auto-Allow';
  if (action === 'deny') return 'Auto-Deny';
  return 'Ask me';
}

const TOOL_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function ApprovalPolicyScreen({ visible, onClose, policies, onRefresh, onSet, onDelete }: Props) {
  const theme = useTheme();
  const [customTool, setCustomTool] = useState('');
  const lastTapRef = useRef(0);

  useEffect(() => {
    if (visible) onRefresh();
  }, [visible, onRefresh]);

  const handleTap = (tool: string) => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) return;
    lastTapRef.current = now;
    const current = getPolicyAction(policies, tool);
    const next = cycleAction(current);
    if (next === 'prompt') {
      onDelete(tool);
    } else {
      onSet(tool, next);
    }
  };

  const handleAddCustom = () => {
    const name = customTool.trim();
    if (!name || !TOOL_NAME_PATTERN.test(name)) return;
    onSet(name, 'allow');
    setCustomTool('');
  };

  const badgeBg = (action: PolicyAction): string => {
    if (action === 'allow') return theme.colors.primaryContainer;
    if (action === 'deny') return theme.colors.errorContainer;
    return theme.colors.surfaceVariant;
  };

  const badgeTextColor = (action: PolicyAction): string => {
    if (action === 'allow') return theme.colors.primary;
    if (action === 'deny') return theme.colors.error;
    return theme.colors.onSurfaceVariant;
  };

  const customPolicies = policies.filter(p => !COMMON_TOOLS.includes(p.tool_name));

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={styles.header}>
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>Approval Policies</Text>
          <Button mode="text" onPress={onClose} accessibilityRole="button" accessibilityLabel="Done">Done</Button>
        </View>
        <Text style={[styles.hint, { color: theme.colors.onSurfaceVariant }]}>
          Tap to cycle: Ask me → Auto-Allow → Auto-Deny. Keep Bash, Write, and Edit on Ask me.
        </Text>
        <FlatList
          data={[...COMMON_TOOLS, ...customPolicies.map(p => p.tool_name)]}
          keyExtractor={item => item}
          renderItem={({ item }) => {
            const action = getPolicyAction(policies, item);
            return (
              <Pressable style={[styles.row, { borderBottomColor: theme.colors.outlineVariant }]} onPress={() => handleTap(item)} accessibilityRole="button" accessibilityLabel={`${item}: ${badgeLabel(action)}. Tap to change.`}>
                <Text style={[styles.toolName, { color: theme.colors.onSurface }]}>{item}</Text>
                <View style={[styles.badge, { backgroundColor: badgeBg(action) }]}>
                  <Text style={[styles.badgeText, { color: badgeTextColor(action) }]}>
                    {badgeLabel(action)}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ListFooterComponent={
            <View style={styles.addSection}>
              <Text style={[styles.sectionLabel, { color: theme.colors.onSurfaceVariant }]}>Custom Tool Rule</Text>
              <View style={styles.addRow}>
                <TextInput
                  style={[styles.input, { backgroundColor: theme.colors.surfaceVariant, borderColor: theme.colors.outlineVariant, color: theme.colors.onSurface }]}
                  placeholder="Tool name"
                  placeholderTextColor={theme.colors.onSurfaceVariant}
                  value={customTool}
                  onChangeText={setCustomTool}
                  autoCapitalize="none"
                />
                <Button
                  mode="contained-tonal"
                  onPress={handleAddCustom}
                  disabled={!customTool.trim()}
                >
                  Add
                </Button>
              </View>
            </View>
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, paddingTop: 60 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  title: { fontSize: 20, fontWeight: '700' },
  hint: { fontSize: 13, paddingHorizontal: 20, marginBottom: 16 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toolName: { fontSize: 15 },
  badge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  badgeText: { fontSize: 13, fontWeight: '600' },
  addSection: { paddingHorizontal: 20, paddingTop: 24 },
  sectionLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  addRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    borderWidth: 1,
  },
});
