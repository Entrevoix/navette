import { create } from "zustand";
import type { EventFrame, SessionInfo } from "../types";

interface SessionState {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  events: EventFrame[];
  viewStartSeq: number;
  unreadSessions: Set<string>;

  setSessions: (sessions: SessionInfo[]) => void;
  setActiveSessionId: (id: string | null) => void;
  addEvent: (event: EventFrame) => void;
  setEvents: (events: EventFrame[]) => void;
  setViewStartSeq: (seq: number) => void;
  markRead: (sessionId: string) => void;
  markUnread: (sessionId: string) => void;
  clearEvents: () => void;
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  sessions: [],
  activeSessionId: null,
  events: [],
  viewStartSeq: 0,
  unreadSessions: new Set(),

  setSessions(sessions: SessionInfo[]) {
    set({ sessions });
  },

  setActiveSessionId(id: string | null) {
    const unread = new Set(get().unreadSessions);
    if (id) unread.delete(id);
    set({ activeSessionId: id, unreadSessions: unread });
  },

  addEvent(event: EventFrame) {
    set((state) => {
      const sessionId = (event.event as Record<string, unknown>)
        .session_id as string | undefined;
      const unread = new Set(state.unreadSessions);
      if (sessionId && sessionId !== state.activeSessionId) {
        unread.add(sessionId);
      }
      return {
        events: [...state.events, event],
        unreadSessions: unread,
      };
    });
  },

  setEvents(events: EventFrame[]) {
    set({ events });
  },

  setViewStartSeq(seq: number) {
    set({ viewStartSeq: seq });
  },

  markRead(sessionId: string) {
    const unread = new Set(get().unreadSessions);
    unread.delete(sessionId);
    set({ unreadSessions: unread });
  },

  markUnread(sessionId: string) {
    const unread = new Set(get().unreadSessions);
    unread.add(sessionId);
    set({ unreadSessions: unread });
  },

  clearEvents() {
    set({ events: [], viewStartSeq: 0 });
  },
}));
