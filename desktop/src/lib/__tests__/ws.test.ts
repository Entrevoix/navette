import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createNavetteWS } from "../ws";

// Minimal WebSocket mock
class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  sentMessages: string[] = [];

  constructor(public url: string) {
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sentMessages.push(data);
  }

  close() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  // Test helper: simulate server sending a message
  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  // Test helper: simulate connection open
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  static instances: MockWebSocket[] = [];

  static reset() {
    MockWebSocket.instances = [];
  }
}

beforeEach(() => {
  MockWebSocket.reset();
  vi.stubGlobal("WebSocket", MockWebSocket);
  // Stub localStorage
  vi.stubGlobal("localStorage", {
    getItem: vi.fn().mockReturnValue(null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
  });
  // Stub crypto.randomUUID used at module level (already called, but needed for re-import safety)
  vi.stubGlobal("crypto", { randomUUID: () => "test-uuid" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createNavetteWS", () => {
  it("returns an object with connect, disconnect, send, onMessage, onStatusChange", () => {
    const ws = createNavetteWS();
    expect(typeof ws.connect).toBe("function");
    expect(typeof ws.disconnect).toBe("function");
    expect(typeof ws.send).toBe("function");
    expect(typeof ws.onMessage).toBe("function");
    expect(typeof ws.onStatusChange).toBe("function");
  });

  it("onStatusChange fires with 'connecting' when connect is called", () => {
    const ws = createNavetteWS();
    const statuses: string[] = [];
    ws.onStatusChange((s) => statuses.push(s));

    ws.connect({ host: "localhost", port: "7878", token: "abc" });

    expect(statuses).toContain("connecting");
  });

  it("onMessage subscription receives messages dispatched after subscription", () => {
    const ws = createNavetteWS();
    const received: unknown[] = [];
    ws.onMessage((msg) => received.push(msg));

    ws.connect({ host: "localhost", port: "7878", token: "abc" });
    const socket = MockWebSocket.instances[0];
    socket.simulateMessage({ type: "ping", seq: 1 });

    expect(received).toHaveLength(1);
    expect((received[0] as Record<string, unknown>).type).toBe("ping");
  });

  it("onMessage returns an unsubscribe function that stops delivery", () => {
    const ws = createNavetteWS();
    const received: unknown[] = [];
    const unsub = ws.onMessage((msg) => received.push(msg));

    ws.connect({ host: "localhost", port: "7878", token: "abc" });
    const socket = MockWebSocket.instances[0];

    socket.simulateMessage({ type: "ping", seq: 1 });
    expect(received).toHaveLength(1);

    unsub();
    socket.simulateMessage({ type: "ping", seq: 2 });
    expect(received).toHaveLength(1); // no new message after unsub
  });

  it("multiple onMessage subscribers all receive the same message", () => {
    const ws = createNavetteWS();
    const a: unknown[] = [];
    const b: unknown[] = [];
    ws.onMessage((msg) => a.push(msg));
    ws.onMessage((msg) => b.push(msg));

    ws.connect({ host: "localhost", port: "7878", token: "abc" });
    const socket = MockWebSocket.instances[0];
    socket.simulateMessage({ type: "event", seq: 5 });

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  it("messages with duplicate or lower seq are dropped", () => {
    const ws = createNavetteWS();
    const received: unknown[] = [];
    ws.onMessage((msg) => received.push(msg));

    ws.connect({ host: "localhost", port: "7878", token: "abc" });
    const socket = MockWebSocket.instances[0];

    socket.simulateMessage({ type: "a", seq: 3 });
    socket.simulateMessage({ type: "b", seq: 3 }); // duplicate seq — dropped
    socket.simulateMessage({ type: "c", seq: 2 }); // lower seq — dropped

    expect(received).toHaveLength(1);
  });

  it("onStatusChange fires with 'disconnected' after disconnect is called", () => {
    const ws = createNavetteWS();
    const statuses: string[] = [];
    ws.onStatusChange((s) => statuses.push(s));

    ws.connect({ host: "localhost", port: "7878", token: "abc" });
    ws.disconnect();

    expect(statuses).toContain("disconnected");
  });

  it("onStatusChange returns an unsubscribe function", () => {
    const ws = createNavetteWS();
    const statuses: string[] = [];
    const unsub = ws.onStatusChange((s) => statuses.push(s));

    unsub();
    ws.connect({ host: "localhost", port: "7878", token: "abc" });

    expect(statuses).toHaveLength(0);
  });
});
