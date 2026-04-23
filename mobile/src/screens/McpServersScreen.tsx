// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>MCP Servers</Text>
          <View style={styles.headerRight}>
            <Pressable onPress={onRefresh} hitSlop={12} style={styles.refreshBtn}>
              <Text style={styles.refreshText}>Refresh</Text>
            </Pressable>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Text style={styles.closeText}>Done</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.pathHint}>~/.claude/settings.json</Text>

        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#818cf8" />
            <Text style={styles.loadingText}>Loading MCP servers...</Text>
          </View>
        ) : servers.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🔌</Text>
            <Text style={styles.emptyText}>No MCP servers configured</Text>
            <Text style={styles.emptySubtext}>
              MCP servers are configured in ~/.claude/settings.json on the remote host.
            </Text>
          </View>
        ) : (
          <FlatList
            data={servers}
            keyExtractor={(item) => item.name}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => (
              <View style={styles.card}>
                <View style={styles.cardIcon}>
                  <Text style={styles.cardIconText}>🔌</Text>
                </View>
                <View style={styles.cardBody}>
                  <Text style={styles.serverName}>{item.name}</Text>
                  <Text style={styles.serverCommand} numberOfLines={1}>
                    {item.command}
                  </Text>
                  <View style={styles.badges}>
                    {item.args_count > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{item.args_count} args</Text>
                      </View>
                    )}
                    {item.env_count > 0 && (
                      <View style={styles.badge}>
                        <Text style={styles.badgeText}>{item.env_count} env</Text>
                      </View>
                    )}
                    <View style={styles.statusBadge}>
                      <Text style={styles.statusBadgeText}>configured</Text>
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
  pathHint: {
    color: '#444',
    fontSize: 11,
    fontFamily: 'Menlo',
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { color: '#71717a', fontSize: 14 },
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
  serverName: { color: '#f0f0f0', fontSize: 15, fontWeight: '700', fontFamily: 'Menlo' },
  serverCommand: { color: '#9ca3af', fontSize: 12, fontFamily: 'Menlo' },
  badges: { flexDirection: 'row', gap: 6, marginTop: 4 },
  badge: {
    backgroundColor: '#2a2a3e',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  badgeText: { color: '#71717a', fontSize: 10, fontWeight: '600' },
  statusBadge: {
    backgroundColor: '#14280f',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderWidth: 1,
    borderColor: '#1f4a18',
  },
  statusBadgeText: { color: '#4ade80', fontSize: 10, fontWeight: '600' },
  separator: { height: 8 },
});
