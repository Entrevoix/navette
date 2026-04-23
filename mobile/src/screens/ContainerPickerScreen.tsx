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
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Containers</Text>
          <View style={styles.headerRight}>
            <Pressable onPress={onRefresh} hitSlop={12} style={styles.refreshBtn}>
              <Text style={styles.refreshText}>Refresh</Text>
            </Pressable>
            <Pressable onPress={onClose} hitSlop={12} style={styles.closeBtn}>
              <Text style={styles.closeText}>Done</Text>
            </Pressable>
          </View>
        </View>

        {loading ? (
          <View style={styles.loadingState}>
            <ActivityIndicator size="large" color="#818cf8" />
            <Text style={styles.loadingText}>Fetching containers...</Text>
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
                  style={[styles.card, isSelected && styles.cardSelected]}
                  onPress={() => handleSelect(item.name)}
                >
                  <View style={styles.cardIcon}>
                    <Text style={styles.cardIconText}>{isHost ? '🖥' : '📦'}</Text>
                  </View>
                  <View style={styles.cardBody}>
                    <Text style={[styles.containerName, isSelected && styles.containerNameSelected]}>
                      {item.display || item.name || 'Host (no container)'}
                    </Text>
                    {item.status ? (
                      <Text style={styles.containerStatus}>{item.status}</Text>
                    ) : null}
                    {item.image ? (
                      <Text style={styles.containerImage} numberOfLines={1}>{item.image}</Text>
                    ) : null}
                  </View>
                  {isSelected && <Text style={styles.checkmark}>✓</Text>}
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
  loadingState: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { color: '#71717a', fontSize: 14 },
  listContent: { paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 24 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e1e2e',
    borderRadius: 10,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  cardSelected: { borderColor: '#4ade80', backgroundColor: '#14280f' },
  cardIcon: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#2a2a3e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardIconText: { fontSize: 18 },
  cardBody: { flex: 1, gap: 2 },
  containerName: { color: '#f0f0f0', fontSize: 15, fontWeight: '700' },
  containerNameSelected: { color: '#4ade80' },
  containerStatus: { color: '#9ca3af', fontSize: 12 },
  containerImage: { color: '#52525b', fontSize: 11, fontFamily: 'Menlo' },
  checkmark: { color: '#4ade80', fontSize: 18, fontWeight: '700' },
  separator: { height: 8 },
});
