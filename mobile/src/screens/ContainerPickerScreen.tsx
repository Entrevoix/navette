// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ActivityIndicator, Button, useTheme } from 'react-native-paper';
import type { ContainerInfo } from '../types';

interface ContainerPickerScreenProps {
  visible: boolean;
  onClose: () => void;
  containers: ContainerInfo[];
  onRefresh: () => void;
  selectedContainer: string;
  onSelect: (name: string) => void;
}

export function ContainerPickerScreen({
  visible,
  onClose,
  containers,
  onRefresh,
  selectedContainer,
  onSelect,
}: ContainerPickerScreenProps) {
  const theme = useTheme();

  useEffect(() => {
    if (visible) onRefresh();
  }, [visible, onRefresh]);

  const handleSelect = (name: string) => {
    onSelect(name);
    onClose();
  };

  const loading = visible && containers.length === 0;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: theme.colors.background }]}>
        <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
          <Text style={[styles.title, { color: theme.colors.onSurface }]}>Containers</Text>
          <View style={styles.headerRight}>
            <Button mode="text" compact onPress={onRefresh}>Refresh</Button>
            <Button mode="text" compact onPress={onClose}>Done</Button>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" />
            <Text style={[styles.loadingText, { color: theme.colors.onSurfaceVariant }]}>Fetching containers...</Text>
          </View>
        ) : (
          <FlatList
            data={containers}
            keyExtractor={(item) => item.name || '__host__'}
            contentContainerStyle={styles.listContent}
            renderItem={({ item }) => {
              const isHost = !item.name;
              const isSelected = isHost
                ? !selectedContainer
                : item.name === selectedContainer;
              return (
                <Pressable
                  style={[styles.card, { backgroundColor: theme.colors.surfaceVariant, borderColor: 'transparent' }, isSelected && { borderColor: theme.colors.primary, backgroundColor: theme.colors.primaryContainer }]}
                  onPress={() => handleSelect(item.name)}
                >
                  <View style={[styles.cardIcon, { backgroundColor: theme.colors.surface }]}>
                    <Text style={styles.cardIconText}>{isHost ? '🖥' : '📦'}</Text>
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={[styles.containerName, { color: theme.colors.onSurface }, isSelected && { color: theme.colors.primary }]}>
                      {item.display || item.name || 'Host (no container)'}
                    </Text>
                    {item.status ? (
                      <Text style={[styles.containerStatus, { color: theme.colors.onSurfaceVariant }]}>{item.status}</Text>
                    ) : null}
                    {item.image ? (
                      <Text style={[styles.containerImage, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>{item.image}</Text>
                    ) : null}
                  </View>
                  {isSelected && <Text style={[styles.checkmark, { color: theme.colors.primary }]}>✓</Text>}
                </Pressable>
              );
            }}
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
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { fontSize: 14 },
  listContent: { paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 24 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    padding: 16,
    gap: 12,
    borderWidth: 1,
  },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconText: { fontSize: 18 },
  cardBody: { flex: 1, gap: 2 },
  containerName: { fontSize: 15, fontWeight: '700' },
  containerStatus: { fontSize: 12 },
  containerImage: { fontSize: 11, fontFamily: 'Menlo' },
  checkmark: { fontSize: 18, fontWeight: '700' },
  separator: { height: 8 },
});
