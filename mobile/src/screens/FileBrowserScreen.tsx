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
import { ConfigEditor } from '../components/ConfigEditor';
import { FileViewer } from '../components/FileViewer';
import type { DirEntry, DirListingEvent, FileContentEvent, FileWriteResultEvent } from '../types';

interface FileBrowserScreenProps {
  visible: boolean;
  onClose: () => void;
  listDir: (path: string, cb: (ev: DirListingEvent) => void) => void;
  readFile: (path: string, cb: (ev: FileContentEvent) => void) => void;
  writeFile: (path: string, content: string, cb: (ev: FileWriteResultEvent) => void) => void;
  initialPath?: string;
}

type ViewMode = 'browser' | 'viewer' | 'editor';

export function FileBrowserScreen({
  visible,
  onClose,
  listDir,
  readFile,
  writeFile,
  initialPath = '~',
}: FileBrowserScreenProps) {
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
      style={styles.entry}
      onPress={() => {
        if (item.is_dir) {
          navigate(currentPath + '/' + item.name);
        } else {
          openFile(currentPath + '/' + item.name);
        }
      }}
    >
      <Text style={styles.entryIcon}>{item.is_dir ? '\u{1F4C1}' : '\u{1F4C4}'}</Text>
      <Text style={[styles.entryName, !item.is_dir && styles.entryFile]} numberOfLines={1}>
        {item.name}
      </Text>
    </Pressable>
  );

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {viewMode === 'browser' && (
          <>
            <View style={styles.header}>
              <Pressable onPress={onClose} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>Close</Text>
              </Pressable>
              <Text style={styles.title}>Files</Text>
              <View style={styles.placeholder} />
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.breadcrumb}>
              <Pressable onPress={() => navigate('/')} style={styles.crumb}>
                <Text style={styles.crumbText}>/</Text>
              </Pressable>
              {pathParts.map((part, i) => (
                <Pressable
                  key={i}
                  onPress={() => navigate('/' + pathParts.slice(0, i + 1).join('/'))}
                  style={styles.crumb}
                >
                  <Text style={[styles.crumbText, i === pathParts.length - 1 && styles.crumbActive]}>
                    {part}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {dirLoading && <Text style={styles.status}>Loading...</Text>}
            {dirError && <Text style={styles.errorText}>{dirError}</Text>}

            <FlatList
              data={[
                ...(currentPath !== '/' ? [{ name: '..', is_dir: true } as DirEntry] : []),
                ...entries,
              ]}
              keyExtractor={(item) => item.name}
              renderItem={({ item }) =>
                item.name === '..' ? (
                  <Pressable style={styles.entry} onPress={() => navigate(currentPath + '/..')}>
                    <Text style={styles.entryIcon}>{'\u{1F4C1}'}</Text>
                    <Text style={styles.entryName}>..</Text>
                  </Pressable>
                ) : (
                  renderEntry({ item })
                )
              }
              style={styles.list}
            />

            <View style={styles.footer}>
              <Text style={styles.footerPath} numberOfLines={1}>{currentPath}</Text>
            </View>
          </>
        )}

        {viewMode === 'viewer' && (
          <>
            <View style={styles.header}>
              <Pressable onPress={() => setViewMode('browser')} style={styles.closeBtn}>
                <Text style={styles.closeBtnText}>Back</Text>
              </Pressable>
              <Text style={styles.title} numberOfLines={1}>
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
  closeBtn: { paddingHorizontal: 8, paddingVertical: 4 },
  closeBtnText: { color: '#9ca3af', fontSize: 15 },
  title: { color: '#e2e8f0', fontSize: 15, fontWeight: '600', flex: 1, textAlign: 'center' },
  placeholder: { width: 50 },
  breadcrumb: {
    flexGrow: 0,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  crumb: { paddingHorizontal: 6, paddingVertical: 2 },
  crumbText: { color: '#71717a', fontSize: 13 },
  crumbActive: { color: '#e2e8f0', fontWeight: '600' },
  status: { color: '#6b7280', textAlign: 'center', paddingVertical: 20, fontSize: 13 },
  errorText: { color: '#f87171', textAlign: 'center', paddingVertical: 20, fontSize: 13 },
  list: { flex: 1 },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#111',
  },
  entryIcon: { fontSize: 16, marginRight: 12 },
  entryName: { color: '#e2e8f0', fontSize: 14, flex: 1 },
  entryFile: { color: '#9ca3af' },
  footer: { padding: 12, borderTopWidth: 1, borderTopColor: '#1a1a1a' },
  footerPath: { color: '#6b7280', fontSize: 11, fontFamily: 'Menlo' },
});
