import { useEffect, useState } from "react";
import { useConnectionStore } from "../store/connectionStore";
import { useFeatureStore } from "../store/featureStore";
import type { EventFrame, PastSessionInfo } from "../types";

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString();
}

function truncateId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id;
}

function eventTypeBadge(event: EventFrame["event"]): string {
  return event.type;
}

interface SessionRowProps {
  session: PastSessionInfo;
  onSelect: (id: string) => void;
}

function SessionRow({ session, onSelect }: SessionRowProps) {
  return (
    <button
      className="w-full rounded-lg border border-(--color-border) bg-(--color-surface) p-4 text-left hover:bg-(--color-surface-dim) transition-colors"
      onClick={() => onSelect(session.session_id)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-medium text-(--color-accent)">
          {truncateId(session.session_id)}
        </span>
        <span className="rounded-full bg-(--color-surface-dim) px-2 py-0.5 text-xs text-(--color-text-muted)">
          {session.event_count} events
        </span>
      </div>
      <div className="mt-1 flex items-center gap-3 text-xs text-(--color-text-muted)">
        <span>Started: {formatDate(session.started_at)}</span>
        <span>Last: {formatTime(session.last_event)}</span>
      </div>
    </button>
  );
}

interface EventListProps {
  sessionId: string;
  events: EventFrame[];
  onBack: () => void;
}

function EventList({ sessionId, events, onBack }: EventListProps) {
  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          className="rounded-md border border-(--color-border) bg-(--color-surface-dim) px-3 py-1.5 text-sm text-(--color-text) hover:bg-(--color-surface-bright) transition-colors"
          onClick={onBack}
        >
          ← Back
        </button>
        <span className="font-mono text-sm text-(--color-text-muted)">
          {truncateId(sessionId)}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {events.length === 0 ? (
          <p className="py-8 text-center text-sm text-(--color-text-muted)">
            No events found.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {events.map((frame) => (
              <li
                key={frame.seq}
                className="flex items-start gap-3 rounded-md bg-(--color-surface-dim) px-3 py-2"
              >
                <span className="mt-0.5 rounded bg-(--color-accent-light) px-1.5 py-0.5 font-mono text-xs text-(--color-accent)">
                  {eventTypeBadge(frame.event)}
                </span>
                <span className="text-xs text-(--color-text-muted)">
                  #{frame.seq} &middot; {formatTime(frame.ts)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function SessionHistory() {
  const ws = useConnectionStore((s) => s.ws);
  const pastSessions = useFeatureStore((s) => s.pastSessions);
  const sessionHistory = useFeatureStore((s) => s.sessionHistory);
  const setPastSessions = useFeatureStore((s) => s.setPastSessions);
  const setSessionHistory = useFeatureStore((s) => s.setSessionHistory);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    ws.send({ type: "list_past_sessions" });
    const unsub = ws.onMessage((msg) => {
      if (msg.type === "past_sessions_list" && Array.isArray(msg.sessions)) {
        setPastSessions(msg.sessions as PastSessionInfo[]);
      }
      if (
        msg.type === "session_history" &&
        typeof msg.session_id === "string" &&
        Array.isArray(msg.events)
      ) {
        setSessionHistory(msg.session_id, msg.events as EventFrame[]);
      }
    });
    return unsub;
  }, [ws, setPastSessions, setSessionHistory]);

  function handleSelect(id: string) {
    setSelectedId(id);
    if (!sessionHistory[id]) {
      ws.send({ type: "get_session_history", session_id: id });
    }
  }

  if (selectedId !== null) {
    const events = sessionHistory[selectedId] ?? [];
    return (
      <div className="h-full p-4">
        <EventList
          sessionId={selectedId}
          events={events}
          onBack={() => setSelectedId(null)}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-semibold text-(--color-text)">
          Session History
        </h2>
        <span className="rounded-full bg-(--color-surface-dim) px-2 py-0.5 text-xs text-(--color-text-muted)">
          {pastSessions.length}
        </span>
      </div>
      {pastSessions.length === 0 ? (
        <p className="py-8 text-center text-sm text-(--color-text-muted)">
          No past sessions found.
        </p>
      ) : (
        <ul className="flex flex-col gap-2 overflow-y-auto">
          {pastSessions.map((session) => (
            <li key={session.session_id}>
              <SessionRow session={session} onSelect={handleSelect} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
