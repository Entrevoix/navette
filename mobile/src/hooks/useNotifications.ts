// Copyright (C) 2025 Entrevoix, Inc.
// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { EventFrame } from '../types';

interface UseNotificationsOptions {
  events: EventFrame[];
  enabled: boolean;
}

export function useNotifications({ events, enabled }: UseNotificationsOptions): void {
  const lastProcessedSeq = useRef(0);
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      appState.current = next;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    for (const frame of events) {
      if (frame.seq <= lastProcessedSeq.current) continue;
      lastProcessedSeq.current = frame.seq;

      if (frame.event.type !== 'session_ended') continue;
      if (appState.current === 'active') continue;

      const ev = frame.event as { type: string; ok: boolean; duration_secs?: number };
      const duration = ev.duration_secs ?? 0;
      if (duration < 60) continue;

      // TODO: integrate expo-notifications for local push when app is backgrounded
      // For now, the daemon's ntfy/Telegram integration handles remote notifications
    }
  }, [events, enabled]);
}
