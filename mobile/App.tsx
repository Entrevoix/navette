// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { PaperProvider } from 'react-native-paper';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, LogBox } from 'react-native';

LogBox.ignoreLogs(['Promise passed to']);

import { ConnectScreen } from './src/screens/ConnectScreen';
import { LockScreen } from './src/screens/LockScreen';
import { MainScreen } from './src/screens/MainScreen';
import { useNavettedWS } from './src/hooks/useNavettedWS';
import { ServerConfig } from './src/types';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { SnackbarProvider } from './src/SnackbarContext';
import { ThemeProvider, useThemeMode } from './src/ThemeContext';


const LAST_CONFIG_KEY = 'navette_last_config';

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppInner />
      </ThemeProvider>
    </ErrorBoundary>
  );
}

function AppInner() {
  const { theme, isDark } = useThemeMode();
  const { status, sessionStatus, sessions, activeSessionId, setActiveSessionId, events, pendingApprovals, lastSeq, viewStartSeq, notifyConfig, testNotificationResult, reconnecting, reconnectCount, connectionLost, connect, retry, disconnect, decide, batchDecide, run, kill, sendInput, getNotifyConfig, sendTestNotification, listDir, readFile, writeFile, skills, listSkills, pastSessions, sessionHistory, listPastSessions, getSessionHistory, scheduledSessions, scheduleSession, cancelScheduledSession, listScheduledSessions, savedPrompts, listPrompts, savePrompt, updatePrompt, deletePrompt, secrets, listSecrets, setSecret, deleteSecret, devices, listDevices, revokeDevice, renameDevice, approvalPolicies, getApprovalPolicies, setApprovalPolicy, deleteApprovalPolicy, containers, listContainers, mcpServers, listMcpServers, searchResults, searchSessions, hasUnread } = useNavettedWS();
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  const configRef = useRef<ServerConfig | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const isConnectedRef = useRef(false);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const LOCK_DELAY_MS = 5 * 60 * 1000;

  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => {
    isConnectedRef.current = status === 'connected' || status === 'authenticating' || status === 'connecting';
  }, [status]);

  // Auto-connect from last session on startup
  useEffect(() => {
    (async () => {
      const raw = await SecureStore.getItemAsync(LAST_CONFIG_KEY);
      if (!raw) return;
      try {
        const cfg = JSON.parse(raw) as ServerConfig;
        setConfig(cfg);
        connect(cfg);
      } catch {}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock after 5 min in background; cancel if user returns sooner
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;

      if (prev === 'active' && next === 'background') {
        if (configRef.current) {
          lockTimerRef.current = setTimeout(() => {
            setIsLocked(true);
            lockTimerRef.current = null;
          }, LOCK_DELAY_MS);
        }
      }

      if (next === 'active' && prev !== 'active') {
        if (lockTimerRef.current !== null) {
          clearTimeout(lockTimerRef.current);
          lockTimerRef.current = null;
        }
        if (configRef.current && !isConnectedRef.current) {
          connect(configRef.current);
        }
      }
    });
    return () => {
      sub.remove();
      if (lockTimerRef.current !== null) {
        clearTimeout(lockTimerRef.current);
      }
    };
  }, [connect, LOCK_DELAY_MS]);

  const handleConnect = async (cfg: ServerConfig) => {
    setConfig(cfg);
    configRef.current = cfg;
    await SecureStore.setItemAsync(LAST_CONFIG_KEY, JSON.stringify(cfg));
    connect(cfg);
  };

  const handleDisconnect = async () => {
    disconnect();
    setConfig(null);
    configRef.current = null;
    setIsLocked(false);
    await SecureStore.deleteItemAsync(LAST_CONFIG_KEY);
  };

  const isConnected = status === 'connected' || status === 'authenticating' || status === 'connecting' || reconnecting || connectionLost;

  return (
    <PaperProvider theme={theme}>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: theme.colors.background }}>
        <SnackbarProvider>
        <StatusBar style={isDark ? 'light' : 'dark'} />
        <SafeAreaProvider>
          {isLocked && isConnected ? (
            <LockScreen onUnlock={() => setIsLocked(false)} />
          ) : isConnected ? (
            <MainScreen
              status={status}
              sessionStatus={sessionStatus}
              sessions={sessions}
              activeSessionId={activeSessionId}
              onSetActiveSessionId={setActiveSessionId}
              events={events}
              pendingApprovals={pendingApprovals}
              lastSeq={lastSeq}
              viewStartSeq={viewStartSeq}
              defaultContainer={config?.container}
              notifyConfig={notifyConfig}
              reconnecting={reconnecting}
              reconnectCount={reconnectCount}
              connectionLost={connectionLost}
              onRetry={retry}
              onDecide={decide}
              onBatchDecide={batchDecide}
              onDisconnect={handleDisconnect}
              onRun={run}
              onKill={kill}
              onSendInput={sendInput}
              onRequestNotifyConfig={getNotifyConfig}
              onSendTestNotification={sendTestNotification}
              testNotificationResult={testNotificationResult}
              listDir={listDir}
              readFile={readFile}
              writeFile={writeFile}
              skills={skills}
              onListSkills={listSkills}
              pastSessions={pastSessions}
              sessionHistory={sessionHistory}
              onListPastSessions={listPastSessions}
              onGetSessionHistory={getSessionHistory}
              scheduledSessions={scheduledSessions}
              onScheduleSession={scheduleSession}
              onCancelScheduledSession={cancelScheduledSession}
              onListScheduledSessions={listScheduledSessions}
              savedPrompts={savedPrompts}
              onListPrompts={listPrompts}
              onSavePrompt={savePrompt}
              onUpdatePrompt={updatePrompt}
              onDeletePrompt={deletePrompt}
              secrets={secrets}
              onListSecrets={listSecrets}
              onSetSecret={setSecret}
              onDeleteSecret={deleteSecret}
              devices={devices}
              onListDevices={listDevices}
              onRevokeDevice={revokeDevice}
              onRenameDevice={renameDevice}
              approvalPolicies={approvalPolicies}
              onGetApprovalPolicies={getApprovalPolicies}
              onSetApprovalPolicy={setApprovalPolicy}
              onDeleteApprovalPolicy={deleteApprovalPolicy}
              mcpServers={mcpServers}
              onListMcpServers={listMcpServers}
              containers={containers}
              onListContainers={listContainers}
              searchResults={searchResults}
              onSearchSessions={searchSessions}
              hasUnread={hasUnread}
            />
          ) : (
            <ConnectScreen
              status={status}
              onConnect={handleConnect}
            />
          )}
        </SafeAreaProvider>
        </SnackbarProvider>
      </GestureHandlerRootView>
    </PaperProvider>
  );
}
