import * as SecureStore from 'expo-secure-store';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, StyleSheet } from 'react-native';

import { ConnectScreen } from './src/screens/ConnectScreen';
import { LockScreen } from './src/screens/LockScreen';
import { MainScreen } from './src/screens/MainScreen';
import { useClaudedWS } from './src/hooks/useClaudedWS';
import { ServerConfig } from './src/types';
import { ErrorBoundary } from './src/components/ErrorBoundary';


const LAST_CONFIG_KEY = 'clauded_last_config';

export default function App() {
  const { status, sessionStatus, sessions, activeSessionId, setActiveSessionId, events, pendingApprovals, lastSeq, viewStartSeq, notifyConfig, testNotificationResult, reconnecting, reconnectCount, connect, disconnect, decide, run, kill, sendInput, getNotifyConfig, sendTestNotification, listDir, skills, listSkills, pastSessions, sessionHistory, listPastSessions, getSessionHistory, scheduledSessions, scheduleSession, cancelScheduledSession, listScheduledSessions } = useClaudedWS();
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

  const isConnected = status === 'connected' || status === 'authenticating' || status === 'connecting';

  return (
    <ErrorBoundary>
      <GestureHandlerRootView style={styles.root}>
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
              onDecide={decide}
              onDisconnect={handleDisconnect}
              onRun={run}
              onKill={kill}
              onSendInput={sendInput}
              onRequestNotifyConfig={getNotifyConfig}
              onSendTestNotification={sendTestNotification}
              testNotificationResult={testNotificationResult}
              listDir={listDir}
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
            />
          ) : (
            <ConnectScreen
              status={status}
              onConnect={handleConnect}
            />
          )}
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
});
