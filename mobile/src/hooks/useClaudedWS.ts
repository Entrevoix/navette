import { useCallback, useEffect, useRef, useState } from 'react';
import { EventFrame, PendingApproval, ConnectionStatus, ServerConfig, AssistantEvent, ToolUseBlock } from '../types';

const CLIENT_ID = `mobile-${Math.random().toString(36).slice(2, 8)}`;

interface UseClaudedWSResult {
  status: ConnectionStatus;
  events: EventFrame[];
  pendingApprovals: PendingApproval[];
  lastSeq: number;
  connect: (config: ServerConfig) => void;
  disconnect: () => void;
  decide: (tool_use_id: string, allow: boolean) => void;
}

export function useClaudedWS(): UseClaudedWSResult {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [events, setEvents] = useState<EventFrame[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<PendingApproval[]>([]);
  const [lastSeq, setLastSeq] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const configRef = useRef<ServerConfig | null>(null);
  const lastSeqRef = useRef(0);
  const resolvedToolIds = useRef<Set<string>>(new Set<string>());

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

  const disconnect = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setStatus('disconnected');
  }, []);

  const processApprovals = useCallback((frame: EventFrame) => {
    const event = frame.event;
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
  }, []);

  const connect = useCallback((config: ServerConfig) => {
    wsRef.current?.close();
    configRef.current = config;
    setStatus('connecting');
    setEvents([]);
    setPendingApprovals([]);
    lastSeqRef.current = 0;
    setLastSeq(0);
    resolvedToolIds.current = new Set<string>();

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
        setStatus('connecting');
        ws.send(JSON.stringify({ type: 'attach', since: 0 }));
        return;
      }

      if (msgType === 'rejected') {
        setStatus('error');
        ws.close();
        return;
      }

      if (msgType === 'caught-up') {
        setStatus('connected');
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

        processApprovals(frame);
      }
    };

    ws.onerror = () => setStatus('error');
    ws.onclose = () => {
      if (wsRef.current === ws) setStatus('disconnected');
    };
  }, [processApprovals]);

  useEffect(() => () => { wsRef.current?.close(); }, []);

  return { status, events, pendingApprovals, lastSeq, connect, disconnect, decide };
}
