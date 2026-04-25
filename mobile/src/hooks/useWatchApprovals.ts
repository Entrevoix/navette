// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import { Platform } from 'react-native';
import type { PendingApproval } from '../types';

let WatchConnectivity: {
  updateApplicationContext: (ctx: Record<string, unknown>) => Promise<void>;
  subscribeToMessages: (cb: (msg: Record<string, unknown>) => void) => { unsubscribe?: () => void };
} | null = null;

if (Platform.OS === 'ios') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    WatchConnectivity = require('react-native-watch-connectivity').default;
  } catch (e) {
    console.warn('react-native-watch-connectivity not available:', e);
  }
}

export function useWatchApprovals(
  approvals: PendingApproval[],
  decide: (id: string, allow: boolean) => void,
): void {
  useEffect(() => {
    if (!WatchConnectivity) return;
    WatchConnectivity.updateApplicationContext({
      pendingApprovals: approvals.slice(0, 5).map(a => ({
        id: a.tool_use_id,
        name: a.tool_name,
        preview: JSON.stringify(a.tool_input).slice(0, 100),
      })),
    }).catch(() => {});
  }, [approvals]);

  useEffect(() => {
    if (!WatchConnectivity) return;
    const sub = WatchConnectivity.subscribeToMessages((msg: Record<string, unknown>) => {
      if (msg.type === 'decide' && typeof msg.id === 'string' && typeof msg.allow === 'boolean') {
        decide(msg.id, msg.allow);
      }
    });
    return () => sub.unsubscribe?.();
  }, [decide]);
}
