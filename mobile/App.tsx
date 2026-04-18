import AsyncStorage from '@react-native-async-storage/async-storage';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import React, { useEffect, useRef, useState } from 'react';
import { AppState, AppStateStatus, StyleSheet } from 'react-native';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { LockScreen } from './src/screens/LockScreen';
import { MainScreen } from './src/screens/MainScreen';
import { useClaudedWS } from './src/hooks/useClaudedWS';
import { ServerConfig } from './src/types';

const LAST_CONFIG_KEY = 'clauded_last_config';

export default function App() {
  const { status, sessionStatus, events, pendingApprovals, lastSeq, notifyConfig, connect, disconnect, decide, run, kill, getNotifyConfig } = useClaudedWS();
  const [config, setConfig] = useState<ServerConfig | null>(null);
  const [isLocked, setIsLocked] = useState(false);

  const configRef = useRef<ServerConfig | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => { configRef.current = config; }, [config]);

  // Auto-connect from last session on startup
  useEffect(() => {
    (async () => {
      const raw = await AsyncStorage.getItem(LAST_CONFIG_KEY);
      if (!raw) return;
      try {
        const cfg = JSON.parse(raw) as ServerConfig;
        setConfig(cfg);
        connect(cfg);
      } catch {}
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Lock on background; reconnect + lock when returning to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = next;

      if (prev === 'active' && (next === 'background' || next === 'inactive')) {
        if (configRef.current) setIsLocked(true);
      }

      if (next === 'active' && prev !== 'active' && configRef.current) {
        connect(configRef.current);
      }
    });
    return () => sub.remove();
  }, [connect]);

  const handleConnect = async (cfg: ServerConfig) => {
    setConfig(cfg);
    configRef.current = cfg;
    await AsyncStorage.setItem(LAST_CONFIG_KEY, JSON.stringify(cfg));
    connect(cfg);
  };

  const handleDisconnect = async () => {
    disconnect();
    setConfig(null);
    configRef.current = null;
    setIsLocked(false);
    await AsyncStorage.removeItem(LAST_CONFIG_KEY);
  };

  const isConnected = status === 'connected' || status === 'authenticating' || status === 'connecting';

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {isLocked && isConnected ? (
          <LockScreen onUnlock={() => setIsLocked(false)} />
        ) : isConnected ? (
          <MainScreen
            status={status}
            sessionStatus={sessionStatus}
            events={events}
            pendingApprovals={pendingApprovals}
            lastSeq={lastSeq}
            defaultContainer={config?.container}
            notifyConfig={notifyConfig}
            onDecide={decide}
            onDisconnect={handleDisconnect}
            onRun={run}
            onKill={kill}
            onRequestNotifyConfig={getNotifyConfig}
          />
        ) : (
          <ConnectScreen
            status={status}
            onConnect={handleConnect}
          />
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
});
