import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import React from 'react';
import { StyleSheet } from 'react-native';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { MainScreen } from './src/screens/MainScreen';
import { useClaudedWS } from './src/hooks/useClaudedWS';
import { ServerConfig } from './src/types';

export default function App() {
  const { status, events, pendingApprovals, lastSeq, connect, disconnect, decide } = useClaudedWS();

  const isConnected = status === 'connected' || status === 'authenticating';

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {isConnected ? (
          <MainScreen
            status={status}
            events={events}
            pendingApprovals={pendingApprovals}
            lastSeq={lastSeq}
            onDecide={decide}
            onDisconnect={disconnect}
          />
        ) : (
          <ConnectScreen
            status={status}
            onConnect={(cfg: ServerConfig) => connect(cfg)}
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
