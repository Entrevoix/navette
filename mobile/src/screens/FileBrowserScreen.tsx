// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from 'react-native-paper';
import { ConfigEditor } from '../components/ConfigEditor';
import { FileViewer } from '../components/FileViewer';
import type { DirEntry, DirListingEvent, FileContentEvent, FileWriteResultEvent } from '../types';

interface FileBrowserScreenProps {
  visible: boolean;
  onClose: () => void;
  listDir: (path: string, cb: (ev: DirListingEvent) => void) => void;
  readFile: (path: string, cb: (ev: FileContentEvent) => void) => void;
  writeFile: (path: string, content: string, cb: (ev: FileWriteResultEvent) => void) => void;
  onSetWorkDir?: (path: string) => void;
  initialPath?: string;
}

type ViewMode = 'browser' | 'viewer' | 'editor';

export function FileBrowserScreen({
  visible,
  onClose,
  listDir,
  readFile,
  writeFile,
  onSetWorkDir,
  initialPath = '~',
}: FileBrowserScreenProps) {
  const theme = useTheme();
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [dirError, setDirError] = useState<string | null>(null);
  const [dirLoading, setDirLoading] = useState(false);

  const [viewMode, setViewMode] = useState<ViewMode>('browser');
  const [filePath, setFilePath] = useState('');
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileSize, setFileSize] = useState<number | undefined>();
  const [fileError, setFileError] = useState<string | undefined>();
  const [fileLoading, setFileLoading] = useState(false);

  const navigate = (path: string) => {
    setDirLoading(true);
    setDirError(null);
    listDir(path, (ev) => {
      setDirLoading(false);
      if (ev.error) {
        setDirError(ev.error);
      } else {
        setCurrentPath(ev.path);
        setEntries(ev.entries);
      }
    });
  };

  const openFile = (path: string) => {
    setFilePath(path);
    setFileContent(null);
    setFileError(undefined);
    setFileSize(undefined);
    setFileLoading(true);
    setViewMode('viewer');
    readFile(path, (ev) => {
      setFileLoading(false);
      if (ev.error) {
        setFileError(ev.error);
      } else {
        setFileContent(ev.content ?? '');
        setFileSize(ev.size);
      }
    });
  };

  useEffect(() => {
    if (visible) {
      setViewMode('browser');
      navigate(initialPath);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const pathParts = currentPath.split('/').filter(Boolean);

  const renderEntry = ({ item }: { item: DirEntry }) => (
    <Pressable
      style={[styles.entry, { borderBottomColor: theme.colors.outlineVariant }]}
      onPress={() => {
        if (item.is_dir) {
          navigate(currentPath + '/' + item.name);
        } else {
          openFile(currentPath + '/' + item.name);
        }
      }}
    >
      <Text style={styles.entryIcon}>{item.is_dir ? '\u{1F4C1}' : '\u{1F4C4}'}</Text>
      <Text style={[styles.entryName, { color: theme.colors.onSurface }, !item.is_dir && { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>
        {item.name}
      </Text>
    </Pressable>
  );

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.container, { backgroundColor: theme.colors.background }]}>
        {viewMode === 'browser' && (
          <>
            <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <Text style={[styles.closeBtnText, { color: theme.colors.onSurfaceVariant }]}>Close</Text>
              </Pressable>
              <Text style={[styles.title, { color: theme.colors.onSurface }]}>Files</Text>
              <View style={styles.placeholder} />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.breadcrumb, { borderBottomColor: theme.colors.outlineVariant }]}>
              <Pressable onPress={() => navigate('/')} style={styles.crumb}>
                <Text style={[styles.crumbText, { color: theme.colors.onSurfaceVariant }]}>/</Text>
              </Pressable>
              {pathParts.map((part, i) => (
                <Pressable
                  key={i}
                  onPress={() => navigate('/' + pathParts.slice(0, i + 1).join('/'))}
                  style={styles.crumb}
                >
                  <Text style={[styles.crumbText, { color: theme.colors.onSurfaceVariant }, i === pathParts.length - 1 && { color: theme.colors.onSurface, fontWeight: '600' }]}>
                    {part}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {dirLoading && <Text style={[styles.status, { color: theme.colors.onSurfaceVariant }]}>Loading...</Text>}
            {dirError && <Text style={[styles.errorText, { color: theme.colors.error }]}>{dirError}</Text>}

            <FlatList
              data={[
                ...(currentPath !== '/' ? [{ name: '..', is_dir: true } as DirEntry] : []),
                ...entries,
              ]}
              keyExtractor={(item) => item.name}
              renderItem={({ item }) =>
                item.name === '..' ? (
                  <Pressable style={[styles.entry, { borderBottomColor: theme.colors.outlineVariant }]} onPress={() => navigate(currentPath + '/..')}>
                    <Text style={styles.entryIcon}>{'\u{1F4C1}'}</Text>
                    <Text style={[styles.entryName, { color: theme.colors.onSurface }]}>..</Text>
                  </Pressable>
                ) : (
                  renderEntry({ item })
                )
              }
              style={styles.list}
            />

            <View style={[styles.footer, { borderTopColor: theme.colors.outlineVariant }]}>
              <Text style={[styles.footerPath, { color: theme.colors.onSurfaceVariant }]} numberOfLines={1}>{currentPath}</Text>
              {onSetWorkDir && (
                <Pressable
                  onPress={() => { onSetWorkDir(currentPath); onClose(); }}
                  style={[styles.setWorkDirBtn, { backgroundColor: theme.colors.primaryContainer }]}
                >
                  <Text style={[styles.setWorkDirText, { color: theme.colors.primary }]}>Use as Working Directory</Text>
                </Pressable>
              )}
            </View>
          </>
        )}

        {viewMode === 'viewer' && (
          <>
            <View style={[styles.header, { borderBottomColor: theme.colors.outlineVariant }]}>
              <Pressable onPress={() => setViewMode('browser')} style={styles.closeBtn}>
                <Text style={[styles.closeBtnText, { color: theme.colors.onSurfaceVariant }]}>Back</Text>
              </Pressable>
              <Text style={[styles.title, { color: theme.colors.onSurface }]} numberOfLines={1}>
                {filePath.split('/').pop()}
              </Text>
              <View style={styles.placeholder} />
            </View>
            <FileViewer
              path={filePath}
              content={fileContent}
              size={fileSize}
              error={fileError}
              loading={fileLoading}
              onEdit={() => setViewMode('editor')}
            />
          </>
        )}

        {viewMode === 'editor' && fileContent !== null && (
          <ConfigEditor
            path={filePath}
            initialContent={fileContent}
            onSave={writeFile}
            onClose={() => {
              openFile(filePath);
            }}
          />
        )}
      </SafeAreaView>
    </Modal>
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
  closeBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  closeBtnText: { fontSize: 15 },
  title: { fontSize: 15, fontWeight: '600', flex: 1, textAlign: 'center' },
  placeholder: { width: 50 },
  breadcrumb: {
    flexGrow: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
  },
  crumb: { paddingHorizontal: 6, paddingVertical: 2 },
  crumbText: { fontSize: 13 },
  status: { textAlign: 'center', paddingVertical: 20, fontSize: 13 },
  errorText: { textAlign: 'center', paddingVertical: 20, fontSize: 13 },
  list: { flex: 1 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  entryIcon: { fontSize: 16, marginRight: 12 },
  entryName: { fontSize: 14, flex: 1 },
  footer: { padding: 12, borderTopWidth: 1, gap: 8 },
  footerPath: { fontSize: 11, fontFamily: 'Menlo' },
  setWorkDirBtn: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, alignItems: 'center' as const },
  setWorkDirText: { fontSize: 13, fontWeight: '600' as const },
});
