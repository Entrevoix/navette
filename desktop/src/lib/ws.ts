import HmacSHA256 from "crypto-js/hmac-sha256";
import Hex from "crypto-js/enc-hex";
import type { ServerConfig } from "../types";

export type MessageHandler = (msg: Record<string, unknown>) => void;

const CLIENT_ID =
  localStorage.getItem("navette_client_id") ??
  (() => {
    const id = `desktop-${crypto.randomUUID()}`;
    localStorage.setItem("navette_client_id", id);
    return id;
  })();
const MAX_RECONNECT_DELAY = 30_000;
const LAST_SEQ_KEY = "navette_last_seq";

export interface NavetteWS {
  connect: (config: ServerConfig) => void;
  disconnect: () => void;
  send: (msg: Record<string, unknown>) => void;
  onMessage: (handler: MessageHandler) => () => void;
  onStatusChange: (handler: (status: string) => void) => () => void;
}

export function createNavetteWS(): NavetteWS {
  let ws: WebSocket | null = null;
  let config: ServerConfig | null = null;
  let lastSeq = parseInt(localStorage.getItem(LAST_SEQ_KEY) || "0", 10);
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let shouldReconnect = false;

  const messageHandlers = new Set<MessageHandler>();
  const statusHandlers = new Set<(status: string) => void>();

  function setStatus(status: string) {
    statusHandlers.forEach((h) => h(status));
  }

  function handleOpen() {
    setStatus("authenticating");
    ws?.send(
      JSON.stringify({
        type: "hello",
        version: 2,
        client_id: CLIENT_ID,
      }),
    );
  }

  function handleMessage(raw: MessageEvent) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.data as string);
    } catch {
      return;
    }

    const type = msg.type as string;

    if (type === "challenge") {
      const challenge = msg.challenge as string;
      const hmac = HmacSHA256(challenge, config!.token).toString(Hex);
      ws?.send(
        JSON.stringify({
          type: "challenge_response",
          response: hmac,
        }),
      );
      return;
    }

    if (type === "welcome") {
      setStatus("connected");
      reconnectAttempt = 0;
      const storedSince = parseInt(
        localStorage.getItem(LAST_SEQ_KEY) || "0",
        10,
      );
      ws?.send(
        JSON.stringify({
          type: "attach",
          since: storedSince,
        }),
      );
    }

    if (type === "rejected") {
      shouldReconnect = false;
      setStatus("error");
      ws?.close();
      return;
    }

    const seq = msg.seq as number | undefined;
    if (typeof seq === "number") {
      if (seq <= lastSeq) return;
      lastSeq = seq;
      localStorage.setItem(LAST_SEQ_KEY, String(seq));
    }

    messageHandlers.forEach((h) => h(msg));
  }

  function handleClose() {
    ws = null;
    if (!shouldReconnect) {
      setStatus("disconnected");
      return;
    }
    setStatus("reconnecting");
    const delay = Math.min(
      1000 * Math.pow(2, reconnectAttempt),
      MAX_RECONNECT_DELAY,
    );
    reconnectAttempt++;
    reconnectTimer = setTimeout(() => doConnect(), delay);
  }

  function doConnect() {
    if (!config) return;
    const scheme = config.tls ? "wss" : "ws";
    const url = `${scheme}://${config.host}:${config.port}`;
    setStatus("connecting");

    try {
      ws = new WebSocket(url);
      ws.onopen = handleOpen;
      ws.onmessage = handleMessage;
      ws.onclose = handleClose;
      ws.onerror = () => {};
    } catch {
      handleClose();
    }
  }

  return {
    connect(cfg: ServerConfig) {
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      config = cfg;
      shouldReconnect = true;
      reconnectAttempt = 0;
      doConnect();
    },

    disconnect() {
      shouldReconnect = false;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.onclose = null;
        ws.close();
        ws = null;
      }
      setStatus("disconnected");
    },

    send(msg: Record<string, unknown>) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },

    onMessage(handler: MessageHandler) {
      messageHandlers.add(handler);
      return () => messageHandlers.delete(handler);
    },

    onStatusChange(handler: (status: string) => void) {
      statusHandlers.add(handler);
      return () => statusHandlers.delete(handler);
    },
  };
}
