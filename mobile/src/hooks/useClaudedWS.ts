import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EventFrame, PendingApproval, ConnectionStatus, ServerConfig, SessionStatus, SessionInfo, AssistantEvent, ToolUseBlock, DirListingEvent, PastSessionInfo, ScheduledSessionInfo, TestNotificationSentEvent } from '../types';

const LAST_SEQ_KEY = 'clauded_last_seq';

const CLIENT_ID = `mobile-${Math.random().toString(36).slice(2, 8)}`;

export interface NotifyConfig {
  topic: string;
  base_url: string;
}

export interface SkillInfo {
  name: string;
  description: string;
}

interface UseClaudedWSResult {
  status: ConnectionStatus;
  sessionStatus: SessionStatus;
  sessions: SessionInfo[];
  activeSessionId: string | null;
  setActiveSessionId: (id: string | null) => void;
  events: EventFrame[];
  pendingApprovals: PendingApproval[];
  lastSeq: number;
  viewStartSeq: number;
  notifyConfig: NotifyConfig | null;
  testNotificationResult: 'idle' | 'sent' | 'failed';
  skills: SkillInfo[];
  pastSessions: PastSessionInfo[];
  sessionHistory: Record<string, EventFrame[]>;
  scheduledSessions: ScheduledSessionInfo[];
  reconnecting: boolean;
  reconnectCount: number;
  connect: (config: ServerConfig) => void;
  disconnect: () => void;
  decide: (tool_use_id: string, allow: boolean) => void;
  run: (prompt: string, container?: string, dangerouslySkipPermissions?: boolean, workDir?: string, command?: string) => void;
  kill: (sessionId?: string) => void;
  sendInput: (text: string, sessionId?: string) => void;
  getNotifyConfig: () => void;
  sendTestNotification: () => void;
  getTokenUsage: (sessionId: string) => void;
  listDir: (path: string, cb: (ev: DirListingEvent) => void) => void;
  listSkills: () => void;
  listPastSessions: () => void;
  getSessionHistory: (sessionId: string) => void;
  scheduleSession: (prompt: string, scheduledAt: number, options?: { container?: string; command?: string }) => void;
  cancelScheduledSession: (id: string) => void;
  listScheduledSessions: () => void;
}

export function useClaudedWS(): UseClaudedWSResult {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [events, setEvents] = useState<EventFrame[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [lastSeq, setLastSeq] = useState(0);
  const [viewStartSeq, setViewStartSeq] = useState(0);
  const [notifyConfig, setNotifyConfig] = useState<NotifyConfig | null>(null);
  const [testNotificationResult, setTestNotificationResult] = useState<'idle' | 'sent' | 'failed'>('idle');
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [pastSessions, setPastSessions] = useState<PastSessionInfo[]>([]);
  const [sessionHistory, setSessionHistory] = useState<Record<string, EventFrame[]>>({});
  const [scheduledSessions, setScheduledSessions] = useState<ScheduledSessionInfo[]>([]);
  const [reconnecting, setReconnecting] = useState(false);
  const [reconnectCount, setReconnectCount] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const lastSeqRef = useRef(0);
  const storedSinceRef = useRef(0);
  const resolvedToolIds = useRef<Set<string>>(new Set<string>());
  const dirListingCallbackRef = useRef<((ev: DirListingEvent) => void) | null>(null);
  const shouldReconnectRef = useRef(false);
  const reconnectDelayRef = useRef(1000);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const serverConfigRef = useRef<ServerConfig | null>(null);

  // Derived: is any session running?
  const sessionStatus: SessionStatus = sessions.length > 0 ? 'running' : 'idle';

  useEffect(() => {
    AsyncStorage.getItem(LAST_SEQ_KEY).then((val: string | null) => {
      if (val) storedSinceRef.current = parseInt(val, 10);
    });
  }, []);

  const decide = useCallback((tool_use_id: string, allow: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'input',
        tool_use_id,
        decision: allow ? 'y' : 'n',
      }));
    }
    resolvedToolIds.current.add(tool_use_id);
    setPendingApprovals((prev: PendingApproval[]) =>
      prev.filter((p: PendingApproval) => p.tool_use_id !== tool_use_id)
    );
  }, []);

  const run = useCallback((prompt: string, container?: string, dangerouslySkipPermissions?: boolean, workDir?: string, command?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'run',
        prompt,
        container: container || null,
        dangerously_skip_permissions: dangerouslySkipPermissions ?? false,
        work_dir: workDir || null,
        command: command || null,
      }));
    }
  }, []);

  const listDir = useCallback((path: string, cb: (ev: DirListingEvent) => void) => {
    dirListingCallbackRef.current = cb;
    wsRef.current?.send(JSON.stringify({ type: 'list_dir', path }));
  }, []);

  const kill = useCallback((sessionId?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'kill_session',
        session_id: sessionId ?? activeSessionId ?? '',
      }));
    }
  }, [activeSessionId]);

  const sendInput = useCallback((text: string, sessionId?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'input',
        session_id: sessionId ?? activeSessionId ?? '',
        data: text.endsWith('\n') ? text : text + '\n',
      }));
    }
  }, [activeSessionId]);

  const getNotifyConfig = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'get_notify_config' }));
    }
  }, []);

  const sendTestNotification = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'send_test_notification' }));
    }
  }, []);

  const getTokenUsage = useCallback((sessionId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'get_token_usage', session_id: sessionId }));
    }
  }, []);

  const listSkills = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'list_skills' }));
    }
  }, []);

  const listPastSessions = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'list_past_sessions' }));
    }
  }, []);

  const getSessionHistory = useCallback((sessionId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'get_session_history', session_id: sessionId }));
    }
  }, []);

  const scheduleSession = useCallback((prompt: string, scheduledAt: number, options?: { container?: string; command?: string }) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'schedule_session',
        prompt,
        scheduled_at: scheduledAt,
        container: options?.container ?? null,
        command: options?.command ?? null,
      }));
    }
  }, []);

  const cancelScheduledSession = useCallback((id: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cancel_scheduled_session', id }));
    }
  }, []);

  const listScheduledSessions = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'list_scheduled_sessions' }));
    }
  }, []);

  const disconnect = useCallback(() => {
    shouldReconnectRef.current = false;
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setReconnecting(false);
    AsyncStorage.setItem(LAST_SEQ_KEY, String(lastSeqRef.current));
    wsRef.current?.close();
    wsRef.current = null;
    setStatus('disconnected');
    setSessions([]);
    setActiveSessionId(null);
    setNotifyConfig(null);
  }, []);

  const processEvent = useCallback((frame: EventFrame) => {
    const event = frame.event;

    if (event.type === 'session_started') {
      return;
    }
    if (event.type === 'session_ended') {
      setPendingApprovals([]);
      return;
    }

    if (event.type === 'session_list_changed') {
      const newSessions = ((event as unknown as { sessions?: SessionInfo[] }).sessions ?? []);
      setSessions(newSessions);
      // Auto-select active session if current is gone or none selected
      setActiveSessionId(prev => {
        if (newSessions.length === 0) return null;
        if (prev && newSessions.some(s => s.session_id === prev)) return prev;
        return newSessions[0].session_id;
      });
      return;
    }

    if (event.type === 'run_accepted') {
      const sid = (event as unknown as { session_id?: string }).session_id;
      if (sid) setActiveSessionId(sid);
      return;
    }

    if (event.type === 'assistant') {
      const assistantEvent = event as AssistantEvent;
      const toolUseBlocks = assistantEvent.message.content.filter(
        (b: { type: string }): b is ToolUseBlock => b.type === 'tool_use'
      );
      for (const block of toolUseBlocks) {
        if (!resolvedToolIds.current.has(block.id)) {
          setPendingApprovals((prev: PendingApproval[]) => {
            if (prev.some((p: PendingApproval) => p.tool_use_id === block.id)) return prev;
            return [...prev, {
              tool_use_id: block.id,
              tool_name: block.name,
              tool_input: block.input,
              seq: frame.seq,
            }];
          });
        }
      }
    }

    if (event.type === 'tool_result') {
      const toolUseId = (event as { type: 'tool_result'; tool_use_id: string }).tool_use_id;
      if (toolUseId) {
        resolvedToolIds.current.add(toolUseId);
        setPendingApprovals((prev: PendingApproval[]) =>
          prev.filter((p: PendingApproval) => p.tool_use_id !== toolUseId)
        );
      }
    }

    if (event.type === 'user') {
      const content = (event as { type: 'user'; message?: { content?: unknown[] } }).message?.content ?? [];
      for (const block of content) {
        const b = block as { type?: string; tool_use_id?: string };
        if (b.type === 'tool_result' && b.tool_use_id) {
          resolvedToolIds.current.add(b.tool_use_id);
          setPendingApprovals((prev: PendingApproval[]) =>
            prev.filter((p: PendingApproval) => p.tool_use_id !== b.tool_use_id)
          );
        }
      }
    }

    if (event.type === 'approval_pending') {
      const { tool_use_id, expires_at } = event as { type: string; tool_use_id: string; expires_at: number };
      setPendingApprovals((prev: PendingApproval[]) =>
        prev.map((p: PendingApproval) =>
          p.tool_use_id === tool_use_id ? { ...p, expires_at } : p
        )
      );
    }

    if (event.type === 'approval_expired') {
      const { tool_use_id } = event as { type: string; tool_use_id: string };
      resolvedToolIds.current.add(tool_use_id);
      setPendingApprovals((prev: PendingApproval[]) =>
        prev.filter((p: PendingApproval) => p.tool_use_id !== tool_use_id)
      );
    }

    if (event.type === 'approval_warning') {
      const { tool_use_id } = event as { type: string; tool_use_id: string };
      setPendingApprovals((prev: PendingApproval[]) =>
        prev.map((p: PendingApproval) =>
          p.tool_use_id === tool_use_id ? { ...p, urgent: true } : p
        )
      );
    }

    if (event.type === 'dir_listing') {
      dirListingCallbackRef.current?.(event as unknown as DirListingEvent);
    }

    if (event.type === 'scheduled_session_fired') {
      const firedId = (event as { type: string; scheduled_id?: string }).scheduled_id;
      if (firedId) {
        setScheduledSessions(prev =>
          prev.map(s => s.id === firedId ? { ...s, fired: true } : s)
        );
      }
    }
  }, []);

  const connectWS = useCallback((config: ServerConfig, sinceSeq: number) => {
    wsRef.current?.close();
    setStatus('connecting');

    const url = `ws://${config.host}:${config.port}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setStatus('authenticating');
      ws.send(JSON.stringify({ type: 'hello', token: config.token, client_id: CLIENT_ID }));
    };

    ws.onmessage = (evt: MessageEvent) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(evt.data as string) as Record<string, unknown>;
      } catch {
        return;
      }

      const msgType = msg['type'] as string | undefined;

      if (msgType === 'welcome') {
        const serverSessions = (msg['sessions'] as SessionInfo[] | undefined) ?? [];
        const serverHeadSeq = msg['head_seq'] as number | undefined;
        const effectiveSince = (serverHeadSeq !== undefined && sinceSeq > serverHeadSeq) ? 0 : sinceSeq;

        setSessions(serverSessions);
        if (serverSessions.length > 0) {
          setActiveSessionId(serverSessions[0].session_id);
        } else {
          setActiveSessionId(null);
        }
        setStatus('connecting');

        // Only reset event history on a fresh connect (sinceSeq === 0), not on reconnect
        if (sinceSeq === 0) {
          setEvents([]);
          setPendingApprovals([]);
          lastSeqRef.current = 0;
          setLastSeq(0);
          resolvedToolIds.current = new Set<string>();
        }
        setViewStartSeq(serverHeadSeq ?? 0);

        ws.send(JSON.stringify({ type: 'attach', since: effectiveSince }));
        return;
      }

      if (msgType === 'rejected') {
        shouldReconnectRef.current = false;
        setStatus('error');
        ws.close();
        return;
      }

      if (msgType === 'caught-up') {
        // Reset backoff on successful connection
        reconnectDelayRef.current = 1000;
        setReconnecting(false);
        setStatus('connected');
        AsyncStorage.setItem(LAST_SEQ_KEY, String(lastSeqRef.current));
        if (sessions.length === 0) {
          setPendingApprovals([]);
        }
        return;
      }

      if (msgType === 'notify_config') {
        setNotifyConfig({
          topic: (msg['topic'] as string) ?? '',
          base_url: (msg['base_url'] as string) ?? '',
        });
        return;
      }

      if (msgType === 'test_notification_sent') {
        const ev = msg as unknown as TestNotificationSentEvent;
        setTestNotificationResult(ev.ok ? 'sent' : 'failed');
        return;
      }

      if (msgType === 'dir_listing') {
        dirListingCallbackRef.current?.(msg as unknown as DirListingEvent);
        return;
      }

      if (msgType === 'skills_list') {
        setSkills((msg['skills'] as SkillInfo[] | undefined) ?? []);
        return;
      }

      if (msgType === 'past_sessions_list') {
        setPastSessions((msg['sessions'] as PastSessionInfo[] | undefined) ?? []);
        return;
      }

      if (msgType === 'session_history') {
        const sid = msg['session_id'] as string | undefined;
        const evs = (msg['events'] as EventFrame[] | undefined) ?? [];
        if (sid) {
          setSessionHistory(prev => ({ ...prev, [sid]: evs }));
        }
        return;
      }

      if (msgType === 'scheduled_sessions_list') {
        setScheduledSessions((msg['sessions'] as ScheduledSessionInfo[] | undefined) ?? []);
        return;
      }

      if (msgType === 'session_scheduled') {
        // Refresh the list so the new entry appears.
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({ type: 'list_scheduled_sessions' }));
        }
        return;
      }

      if (msgType === 'scheduled_session_cancelled') {
        const cancelledId = msg['id'] as string | undefined;
        if (cancelledId) {
          setScheduledSessions(prev => prev.filter(s => s.id !== cancelledId));
        }
        return;
      }

      if (msgType === 'token_usage') {
        const sid = msg['session_id'] as string | undefined;
        if (sid) {
          setSessions((prev: SessionInfo[]) =>
            prev.map((s: SessionInfo) =>
              s.session_id === sid
                ? {
                    ...s,
                    input_tokens: (msg['input_tokens'] as number) ?? s.input_tokens,
                    output_tokens: (msg['output_tokens'] as number) ?? s.output_tokens,
                    cache_read_tokens: (msg['cache_read_tokens'] as number) ?? s.cache_read_tokens,
                  }
                : s
            )
          );
        }
        return;
      }

      if ('seq' in msg && 'event' in msg) {
        const frame = msg as unknown as EventFrame;
        const seq = frame.seq;
        lastSeqRef.current = Math.max(lastSeqRef.current, seq);
        setLastSeq(lastSeqRef.current);

        setEvents((prev: EventFrame[]) => {
          if (prev.some((e: EventFrame) => e.seq === seq)) return prev;
          return [...prev, frame].sort((a: EventFrame, b: EventFrame) => a.seq - b.seq);
        });

        processEvent(frame);
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      setStatus('disconnected');
      setSessions([]);
      setActiveSessionId(null);
      setPendingApprovals([]);

      if (!shouldReconnectRef.current || serverConfigRef.current === null) return;

      // Schedule reconnect with exponential backoff
      setReconnecting(true);
      const delay = reconnectDelayRef.current;
      reconnectDelayRef.current = Math.min(reconnectDelayRef.current * 2, 30000);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!shouldReconnectRef.current || serverConfigRef.current === null) return;
        setReconnectCount(c => c + 1);
        connectWS(serverConfigRef.current, lastSeqRef.current);
      }, delay);
    };
  }, [processEvent, sessions.length]);

  const connect = useCallback((config: ServerConfig) => {
    serverConfigRef.current = config;
    shouldReconnectRef.current = true;
    reconnectDelayRef.current = 1000;
    setReconnectCount(0);
    setReconnecting(false);
    connectWS(config, storedSinceRef.current);
  }, [connectWS]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  return {
    status,
    sessionStatus,
    sessions,
    activeSessionId,
    setActiveSessionId,
    events,
    pendingApprovals,
    lastSeq,
    viewStartSeq,
    notifyConfig,
    testNotificationResult,
    skills,
    pastSessions,
    sessionHistory,
    scheduledSessions,
    reconnecting,
    reconnectCount,
    connect,
    disconnect,
    decide,
    run,
    kill,
    sendInput,
    getNotifyConfig,
    sendTestNotification,
    getTokenUsage,
    listDir,
    listSkills,
    listPastSessions,
    getSessionHistory,
    scheduleSession,
    cancelScheduledSession,
    listScheduledSessions,
  };
}
