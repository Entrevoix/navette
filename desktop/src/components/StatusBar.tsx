import { useConnectionStore } from "../store/connectionStore";
import { useSessionStore } from "../store/sessionStore";

export function StatusBar() {
  const { status, reconnectCount, currentConfig, disconnect } =
    useConnectionStore();
  const sessions = useSessionStore((s) => s.sessions);

  const statusDot =
    status === "connected"
      ? "bg-(--color-success)"
      : status === "reconnecting"
        ? "bg-(--color-warning) animate-pulse"
        : status === "connecting" || status === "authenticating"
          ? "bg-(--color-warning)"
          : "bg-(--color-danger)";

  const statusText =
    status === "reconnecting"
      ? `Reconnecting (attempt ${reconnectCount})...`
      : status === "authenticating"
        ? "Authenticating..."
        : status;

  const addr = currentConfig
    ? `${currentConfig.tls ? "wss" : "ws"}://${currentConfig.host}:${currentConfig.port}`
    : "";

  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-t border-(--color-border) bg-(--color-surface-dim) text-xs text-(--color-text-muted)">
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <div className={`w-2 h-2 rounded-full ${statusDot}`} />
          <span className="capitalize">{statusText}</span>
        </div>
        {sessions.length > 0 && (
          <span>
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
        )}
        {addr && <span className="font-mono">{addr}</span>}
      </div>
      {status === "connected" && (
        <button
          onClick={disconnect}
          className="hover:text-(--color-text) transition-colors"
        >
          Disconnect
        </button>
      )}
    </div>
  );
}
