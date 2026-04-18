import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EventFrame, PendingApproval, ConnectionStatus, ServerConfig, SessionStatus, AssistantEvent, ToolUseBlock } from '../types';

const LAST_SEQ_KEY = 'clauded_last_seq';

const CLIENT_ID = `mobile-${Math.random().toString(36).slice(2, 8)}`;

export interface NotifyConfig {
  topic: string;
  base_url: string;
}

interface UseClaudedWSResult {
  status: ConnectionStatus;
  sessionStatus: SessionStatus;
  events: EventFrame[];
  pendingApprovals: PendingApproval[];
  lastSeq: number;
  notifyConfig: NotifyConfig | null;
  connect: (config: ServerConfig) => void;
  disconnect: () => void;
  decide: (tool_use_id: string, allow: boolean) => void;
  run: (prompt: string, container?: string, dangerouslySkipPermissions?: boolean) => void;
  kill: () => void;
  getNotifyConfig: () => void;
}

export function useClaudedWS(): UseClaudedWSResult {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [events, setEvents] = useState<EventFrame[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [lastSeq, setLastSeq] = useState(0);
  const [notifyConfig, setNotifyConfig] = useState<NotifyConfig | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const lastSeqRef = useRef(0);
  const storedSinceRef = useRef(0);
  const resolvedToolIds = useRef<Set<string>>(new Set<string>());
  const sessionRunningRef = useRef(false);

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

  const run = useCallback((prompt: string, container?: string, dangerouslySkipPermissions?: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({
        type: 'run',
        prompt,
        container: container || null,
        dangerously_skip_permissions: dangerouslySkipPermissions ?? false,
      }));
    }
  }, []);

  const kill = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'kill_session' }));
    }
  }, []);

  const getNotifyConfig = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'get_notify_config' }));
    }
  }, []);

  const disconnect = useCallback(() => {
    AsyncStorage.setItem(LAST_SEQ_KEY, String(lastSeqRef.current));
    wsRef.current?.close();
    wsRef.current = null;
    setStatus('disconnected');
    setSessionStatus('idle');
    setNotifyConfig(null);
  }, []);

  const processEvent = useCallback((frame: EventFrame) => {
    const event = frame.event;

    if (event.type === 'session_started') {
      sessionRunningRef.current = true;
      setSessionStatus('running');
      return;
    }
    if (event.type === 'session_ended') {
      sessionRunningRef.current = false;
      setSessionStatus('idle');
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
  }, []);

  const connect = useCallback((config: ServerConfig) => {
    wsRef.current?.close();
    setStatus('connecting');
    setSessionStatus('idle');
    setEvents([]);
    setPendingApprovals([]);
    lastSeqRef.current = 0;
    setLastSeq(0);
    resolvedToolIds.current = new Set<string>();

    const since = storedSinceRef.current;
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
        const running = msg['session_running'] as boolean | undefined;
        sessionRunningRef.current = running ?? false;
        setSessionStatus(running ? 'running' : 'idle');
        setStatus('connecting');
        ws.send(JSON.stringify({ type: 'attach', since }));
        return;
      }

      if (msgType === 'rejected') {
        setStatus('error');
        ws.close();
        return;
      }

      if (msgType === 'caught-up') {
        setStatus('connected');
        AsyncStorage.setItem(LAST_SEQ_KEY, String(lastSeqRef.current));
        if (!sessionRunningRef.current) {
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

      if ('seq' in msg && 'event' in msg) {
        const frame = msg as unknown as EventFrame;
        const seq = frame.seq;
        lastSeqRef.current = seq;
        setLastSeq(seq);

        setEvents((prev: EventFrame[]) => {
          if (prev.some((e: EventFrame) => e.seq === seq)) return prev;
          return [...prev, frame].sort((a: EventFrame, b: EventFrame) => a.seq - b.seq);
        });

        processEvent(frame);
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => {
      if (wsRef.current === ws) setStatus('disconnected');
    };
  }, [processEvent]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  return { status, sessionStatus, events, pendingApprovals, lastSeq, notifyConfig, connect, disconnect, decide, run, kill, getNotifyConfig };
}
