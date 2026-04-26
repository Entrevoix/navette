import { useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import { useApprovalStore } from "../store/approvalStore";
import { useConnectionStore } from "../store/connectionStore";

export function SessionSidebar() {
  const { sessions, activeSessionId, setActiveSessionId, unreadSessions } =
    useSessionStore();
  const pendingApprovals = useApprovalStore((s) => s.pendingApprovals);
  const ws = useConnectionStore((s) => s.ws);

  const [showNewSession, setShowNewSession] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [workDir, setWorkDir] = useState("");
  const [command, setCommand] = useState("");
  const [dangerouslySkip, setDangerouslySkip] = useState(false);
  const [injectSecrets, setInjectSecrets] = useState(false);

  function handleRun() {
    if (!prompt.trim()) return;
    const msg: Record<string, unknown> = {
      type: "run",
      prompt: prompt.trim(),
    };
    if (workDir) msg.work_dir = workDir;
    if (command) msg.command = command;
    if (dangerouslySkip) msg.dangerously_skip_permissions = true;
    if (injectSecrets) msg.inject_secrets = true;
    ws.send(msg);
    setPrompt("");
    setShowNewSession(false);
  }

  function formatElapsed(startedAt: number): string {
    const secs = Math.floor(Date.now() / 1000 - startedAt);
    if (secs < 60) return `${secs}s`;
    if (secs < 3600) return `${Math.floor(secs / 60)}m`;
    return `${Math.floor(secs / 3600)}h ${Math.floor((secs % 3600) / 60)}m`;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-3 border-b border-(--color-border)">
        <h2 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide">
          Sessions
        </h2>
      </div>

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sessions.map((s) => {
          const isActive = s.session_id === activeSessionId;
          const hasPending = pendingApprovals.some(
            (a) =>
              (a as unknown as Record<string, unknown>).session_id ===
              s.session_id,
          );
          const isUnread = unreadSessions.has(s.session_id);

          return (
            <button
              key={s.session_id}
              onClick={() => setActiveSessionId(s.session_id)}
              className={`w-full text-left p-2.5 rounded-lg transition-colors ${
                isActive
                  ? "bg-(--color-accent-light) border border-(--color-accent)/30"
                  : "hover:bg-(--color-surface-bright) border border-transparent"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-1.5">
                  <div
                    className={`w-2 h-2 rounded-full ${hasPending ? "bg-(--color-warning) animate-pulse" : "bg-(--color-success)"}`}
                  />
                  <span className="text-xs font-medium text-(--color-text-muted)">
                    {s.agent_type || "claude"}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {isUnread && (
                    <div className="w-1.5 h-1.5 rounded-full bg-(--color-accent)" />
                  )}
                  <span className="text-xs text-(--color-text-muted)">
                    {formatElapsed(s.started_at)}
                  </span>
                </div>
              </div>
              <p className="text-sm text-(--color-text) truncate">
                {s.prompt || "Session"}
              </p>
              {(s.input_tokens || s.output_tokens) && (
                <p className="text-xs text-(--color-text-muted) mt-0.5">
                  ↑{((s.input_tokens || 0) / 1000).toFixed(1)}k ↓
                  {((s.output_tokens || 0) / 1000).toFixed(1)}k
                </p>
              )}
            </button>
          );
        })}

        {sessions.length === 0 && !showNewSession && (
          <p className="text-sm text-(--color-text-muted) text-center py-8">
            No active sessions
          </p>
        )}
      </div>

      <div className="p-2 border-t border-(--color-border)">
        {showNewSession ? (
          <div className="space-y-2">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Enter prompt..."
              className="w-full px-3 py-2 text-sm rounded-lg bg-(--color-surface-bright) border border-(--color-border) text-(--color-text) placeholder:text-(--color-text-muted)/50 focus:outline-none focus:border-(--color-accent) resize-none transition-colors"
              rows={3}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleRun();
                }
              }}
              autoFocus
            />

            {showAdvanced && (
              <div className="space-y-2 p-2 rounded-lg bg-(--color-surface-dim) text-xs">
                <input
                  type="text"
                  value={workDir}
                  onChange={(e) => setWorkDir(e.target.value)}
                  placeholder="Working directory"
                  className="w-full px-2 py-1.5 rounded bg-(--color-surface-bright) border border-(--color-border) text-(--color-text)"
                />
                <input
                  type="text"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="Custom command (e.g. codex, aider)"
                  className="w-full px-2 py-1.5 rounded bg-(--color-surface-bright) border border-(--color-border) text-(--color-text)"
                />
                <label className="flex items-center gap-2 text-(--color-text-muted) cursor-pointer">
                  <input
                    type="checkbox"
                    checked={injectSecrets}
                    onChange={(e) => setInjectSecrets(e.target.checked)}
                  />
                  Inject secrets
                </label>
                <label className="flex items-center gap-2 text-(--color-danger) cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dangerouslySkip}
                    onChange={(e) => setDangerouslySkip(e.target.checked)}
                  />
                  Skip permissions (dangerous)
                </label>
              </div>
            )}

            <div className="flex gap-1">
              <button
                onClick={handleRun}
                disabled={!prompt.trim()}
                className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-(--color-accent) text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                Run
              </button>
              <button
                onClick={() => setShowAdvanced(!showAdvanced)}
                className="px-2 py-1.5 text-xs rounded-lg border border-(--color-border) text-(--color-text-muted) hover:bg-(--color-surface-dim) transition-colors"
              >
                {showAdvanced ? "−" : "⚙"}
              </button>
              <button
                onClick={() => setShowNewSession(false)}
                className="px-2 py-1.5 text-xs rounded-lg border border-(--color-border) text-(--color-text-muted) hover:bg-(--color-surface-dim) transition-colors"
              >
                ✕
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowNewSession(true)}
            className="w-full px-3 py-2 text-sm font-medium rounded-lg border border-dashed border-(--color-border) text-(--color-text-muted) hover:border-(--color-accent) hover:text-(--color-accent) transition-colors"
          >
            + New Session
          </button>
        )}
      </div>
    </div>
  );
}
