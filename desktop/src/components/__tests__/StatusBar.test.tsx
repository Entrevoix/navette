import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusBar } from "../StatusBar";
import { useConnectionStore } from "../../store/connectionStore";
import { useSessionStore } from "../../store/sessionStore";

beforeEach(() => {
  useConnectionStore.setState({
    status: "disconnected",
    reconnectCount: 0,
    currentConfig: null,
  } as Parameters<typeof useConnectionStore.setState>[0]);
  useSessionStore.setState({
    sessions: [],
    activeSessionId: null,
    events: [],
    viewStartSeq: 0,
    unreadSessions: new Set(),
  });
});

describe("StatusBar", () => {
  it("shows connection status text", () => {
    render(<StatusBar />);
    expect(screen.getByText(/disconnected/i)).toBeInTheDocument();
  });

  it("shows 'Authenticating...' when status is authenticating", () => {
    useConnectionStore.setState({ status: "authenticating" } as Parameters<
      typeof useConnectionStore.setState
    >[0]);
    render(<StatusBar />);
    expect(screen.getByText("Authenticating...")).toBeInTheDocument();
  });

  it("shows reconnecting text with attempt count when reconnecting", () => {
    useConnectionStore.setState({
      status: "reconnecting",
      reconnectCount: 2,
    } as Parameters<typeof useConnectionStore.setState>[0]);
    render(<StatusBar />);
    expect(screen.getByText("Reconnecting (attempt 2)...")).toBeInTheDocument();
  });

  it("shows session count when sessions exist", () => {
    useSessionStore.setState({
      sessions: [
        { session_id: "s1", prompt: "p1", started_at: 0 },
        { session_id: "s2", prompt: "p2", started_at: 0 },
      ],
    });
    render(<StatusBar />);
    expect(screen.getByText(/2 sessions/i)).toBeInTheDocument();
  });

  it("does not show session count when no sessions", () => {
    render(<StatusBar />);
    expect(screen.queryByText(/session/i)).not.toBeInTheDocument();
  });

  it("shows disconnect button when connected", () => {
    useConnectionStore.setState({ status: "connected" } as Parameters<
      typeof useConnectionStore.setState
    >[0]);
    render(<StatusBar />);
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
  });

  it("does not show disconnect button when disconnected", () => {
    render(<StatusBar />);
    expect(screen.queryByRole("button", { name: /disconnect/i })).not.toBeInTheDocument();
  });

  it("shows the server address when currentConfig is set and connected", () => {
    useConnectionStore.setState({
      status: "connected",
      currentConfig: { host: "myhost", port: "7878", token: "t", tls: false },
    } as Parameters<typeof useConnectionStore.setState>[0]);
    render(<StatusBar />);
    expect(screen.getByText("ws://myhost:7878")).toBeInTheDocument();
  });

  it("uses singular 'session' when there is exactly one session", () => {
    useSessionStore.setState({
      sessions: [{ session_id: "s1", prompt: "p", started_at: 0 }],
    });
    render(<StatusBar />);
    expect(screen.getByText("1 session")).toBeInTheDocument();
  });
});
