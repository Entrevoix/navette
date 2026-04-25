// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import React, { createContext, useCallback, useContext, useState } from 'react';
import { Snackbar } from 'react-native-paper';

interface SnackbarContextValue {
  showSnackbar: (message: string) => void;
}

const SnackbarContext = createContext<SnackbarContextValue>({ showSnackbar: () => {} });

export function useSnackbar(): SnackbarContextValue {
  return useContext(SnackbarContext);
}

export function SnackbarProvider({ children }: { children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [message, setMessage] = useState('');

  const showSnackbar = useCallback((msg: string) => {
    setMessage(msg);
    setVisible(true);
  }, []);

  return (
    <SnackbarContext.Provider value={{ showSnackbar }}>
      {children}
      <Snackbar
        visible={visible}
        onDismiss={() => setVisible(false)}
        duration={3000}
        action={{ label: 'OK', onPress: () => setVisible(false) }}
      >
        {message}
      </Snackbar>
    </SnackbarContext.Provider>
  );
}
