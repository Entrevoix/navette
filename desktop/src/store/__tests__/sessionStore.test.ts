import { describe, it, expect, beforeEach } from "vitest";
import { useSessionStore } from "../sessionStore";
import type { EventFrame, SessionInfo } from "../../types/index";

function makeSession(id: string): SessionInfo {
  return {
    session_id: id,
    prompt: "test prompt",
    started_at: Date.now(),
  };
}

function makeEvent(sessionId: string, seq: number): EventFrame {
  return {
    seq,
    ts: Date.now(),
    event: { type: "system", subtype: "init", session_id: sessionId },
  };
}

beforeEach(() => {
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    events: [],
    viewStartSeq: 0,
    unreadSessions: new Set(),
  });
});

describe("sessionStore", () => {
  it("addEvent appends to events array", () => {
    const event = makeEvent("s1", 1);
    useSessionStore.getState().addEvent(event);
    expect(useSessionStore.getState().events).toHaveLength(1);
    expect(useSessionStore.getState().events[0]).toBe(event);
  });

  it("addEvent marks session as unread when not active", () => {
    useSessionStore.setState({ activeSessionId: "other" });
    const event = makeEvent("s1", 1);
    useSessionStore.getState().addEvent(event);
    expect(useSessionStore.getState().unreadSessions.has("s1")).toBe(true);
  });

  it("addEvent does not mark active session as unread", () => {
    useSessionStore.setState({ activeSessionId: "s1" });
    const event = makeEvent("s1", 1);
    useSessionStore.getState().addEvent(event);
    expect(useSessionStore.getState().unreadSessions.has("s1")).toBe(false);
  });

  it("setActiveSessionId updates activeSessionId", () => {
    useSessionStore.getState().setActiveSessionId("s1");
    expect(useSessionStore.getState().activeSessionId).toBe("s1");
  });

  it("setActiveSessionId clears the session from unreadSessions", () => {
    useSessionStore.setState({
      unreadSessions: new Set(["s1", "s2"]),
      activeSessionId: null,
    });
    useSessionStore.getState().setActiveSessionId("s1");
    expect(useSessionStore.getState().unreadSessions.has("s1")).toBe(false);
    expect(useSessionStore.getState().unreadSessions.has("s2")).toBe(true);
  });

  it("markRead removes the session from unreadSessions", () => {
    useSessionStore.setState({
      unreadSessions: new Set(["s1", "s2"]),
    });
    useSessionStore.getState().markRead("s1");
    expect(useSessionStore.getState().unreadSessions.has("s1")).toBe(false);
    expect(useSessionStore.getState().unreadSessions.has("s2")).toBe(true);
  });

  it("setSessions replaces the session list", () => {
    const sessions = [makeSession("a"), makeSession("b")];
    useSessionStore.getState().setSessions(sessions);
    expect(useSessionStore.getState().sessions).toHaveLength(2);
    expect(useSessionStore.getState().sessions[0].session_id).toBe("a");
  });

  it("setSessions replaces a previously set list", () => {
    useSessionStore.getState().setSessions([makeSession("old")]);
    useSessionStore.getState().setSessions([makeSession("new1"), makeSession("new2")]);
    expect(useSessionStore.getState().sessions).toHaveLength(2);
    expect(useSessionStore.getState().sessions[0].session_id).toBe("new1");
  });

  it("clearEvents resets events and viewStartSeq", () => {
    useSessionStore.getState().addEvent(makeEvent("s1", 1));
    useSessionStore.getState().setViewStartSeq(5);
    useSessionStore.getState().clearEvents();
    expect(useSessionStore.getState().events).toHaveLength(0);
    expect(useSessionStore.getState().viewStartSeq).toBe(0);
  });

  it("markUnread adds a session to unreadSessions", () => {
    useSessionStore.getState().markUnread("s3");
    expect(useSessionStore.getState().unreadSessions.has("s3")).toBe(true);
  });
});
