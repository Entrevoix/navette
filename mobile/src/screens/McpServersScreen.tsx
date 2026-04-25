// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ActivityIndicator, Button, useTheme } from 'react-native-paper';
import type { McpServerInfo } from '../types';

interface McpServersScreenProps {
  visible: boolean;
  onClose: () => void;
  servers: McpServerInfo[];
  onRefresh: () => void;
}

export function McpServersScreen({
  visible,
  onClose,
  servers,
  onRefresh,
}: McpServersScreenProps) {
  const theme = useTheme();
  const [hasLoaded, setHasLoaded] = React.useState(false);

  useEffect(() => {
    if (visible) {
      setHasLoaded(false);
      onRefresh();
    }
  }, [visible, onRefresh]);

  useEffect(() => {
    if (visible && servers.length > 0) setHasLoaded(true);
  }, [visible, servers]);

  const loading = visible && !hasLoaded && servers.length === 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>MCP Servers</Text>
          <View style={styles.headerRight}>
            <Button mode="text" onPress={onRefresh}>Refresh</Button>
            <Button mode="text" onPress={onClose}>Done</Button>
          </View>
        </View>

        <Text style={[styles.pathHint, { color: theme.colors.onSurfaceVariant }]}>~/.claude/settings.json</Text>

        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" />
            <Text style={[styles.loadingText, { color: theme.colors.onSurfaceVariant }]}>Loading MCP servers...</Text>
          </View>
        ) : servers.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔌</Text>
            <Text style={[styles.emptyText, { color: theme.colors.onSurfaceVariant }]}>No MCP servers configured</Text>
            <Text style={[styles.emptySubtext, { color: theme.colors.onSurfaceVariant }]}>
              MCP servers are configured in ~/.claude/settings.json on the remote host.
            </Text>
          </View>
        ) : (
          <FlatList
            data={servers}
            keyExtractor={(item) => item.name}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={[styles.card, { backgroundColor: theme.colors.surfaceVariant }]}>
                <View style={[styles.cardIcon, { backgroundColor: theme.colors.surface }]}>
                  <Text style={styles.cardIconText}>🔌</Text>
                </View>
                <View style={styles.cardBody}>
                  <Text style={[styles.serverName, { color: theme.colors.onSurface }]}>{item.name}</Text>
                  <Text style={[styles.serverCommand, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
                    {item.command}
                  </Text>
                  <View style={styles.badges}>
                    {item.args_count > 0 && (
                      <View style={[styles.badge, { backgroundColor: theme.colors.surface }]}>
                        <Text style={[styles.badgeText, { color: theme.colors.onSurfaceVariant }]}>{item.args_count} args</Text>
                      </View>
                    )}
                    {item.env_count > 0 && (
                      <View style={[styles.badge, { backgroundColor: theme.colors.surface }]}>
                        <Text style={[styles.badgeText, { color: theme.colors.onSurfaceVariant }]}>{item.env_count} env</Text>
                      </View>
                    )}
                    <View style={[styles.statusBadge, { backgroundColor: theme.colors.primaryContainer, borderColor: theme.colors.primary }]}>
                      <Text style={[styles.statusBadgeText, { color: theme.colors.primary }]}>configured</Text>
                    </View>
                  </View>
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
  pathHint: {
    fontSize: 11,
    fontFamily: 'Menlo',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontSize: 14 },
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
  serverName: { fontSize: 15, fontWeight: '700', fontFamily: 'Menlo' },
  serverCommand: { fontSize: 12, fontFamily: 'Menlo' },
  badges: { flexDirection: 'row', gap: 6, marginTop: 4 },
  badge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { fontSize: 10, fontWeight: '600' },
  statusBadge: {
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
  },
  statusBadgeText: { fontSize: 10, fontWeight: '600' },
  separator: { height: 8 },
});
