import { useState } from "react";
import { useConnectionStore } from "../store/connectionStore";
import type { SavedConfig } from "../types";

export function ConnectForm() {
  const { savedConfigs, connect, saveConfig, deleteConfig, status } =
    useConnectionStore();

  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("7878");
  const [token, setToken] = useState("");
  const [tls, setTls] = useState(false);
  const [configName, setConfigName] = useState("");
  const [showSave, setShowSave] = useState(false);

  function handleConnect(e: React.FormEvent) {
    e.preventDefault();
    connect({ host, port, token, tls });
  }

  function handleUseSaved(config: SavedConfig) {
    setHost(config.host);
    setPort(config.port);
    setToken(config.token);
    setTls(config.tls || false);
    connect(config);
  }

  function handleSave() {
    if (!configName.trim()) return;
    saveConfig({
      id: crypto.randomUUID(),
      name: configName.trim(),
      host,
      port,
      token,
      tls,
    });
    setConfigName("");
    setShowSave(false);
  }

  const isConnecting = status === "connecting" || status === "authenticating";

  return (
    <div className="flex items-center justify-center h-full bg-(--color-surface)">
      <div className="w-full max-w-md p-8 rounded-xl bg-(--color-surface-bright) border border-(--color-border) shadow-lg">
        <h1 className="text-2xl font-semibold mb-1 text-(--color-text)">
          navette
        </h1>
        <p className="text-sm text-(--color-text-muted) mb-6">
          Connect to your navetted daemon
        </p>

        {savedConfigs.length > 0 && (
          <div className="mb-6">
            <p className="text-xs font-medium text-(--color-text-muted) uppercase tracking-wide mb-2">
              Saved Servers
            </p>
            <div className="space-y-1">
              {savedConfigs.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between p-2 rounded-lg hover:bg-(--color-surface-dim) cursor-pointer transition-colors"
                  onClick={() => handleUseSaved(c)}
                >
                  <div>
                    <span className="text-sm font-medium">{c.name}</span>
                    <span className="text-xs text-(--color-text-muted) ml-2">
                      {c.host}:{c.port}
                    </span>
                  </div>
                  <button
                    className="text-xs text-(--color-text-muted) hover:text-(--color-danger) px-2"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConfig(c.id);
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <form onSubmit={handleConnect} className="space-y-4">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-(--color-text-muted) mb-1">
                Host
              </label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-(--color-surface-dim) border border-(--color-border) text-(--color-text) focus:outline-none focus:border-(--color-accent) transition-colors"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs font-medium text-(--color-text-muted) mb-1">
                Port
              </label>
              <input
                type="text"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full px-3 py-2 text-sm rounded-lg bg-(--color-surface-dim) border border-(--color-border) text-(--color-text) focus:outline-none focus:border-(--color-accent) transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-(--color-text-muted) mb-1">
              Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="Auth token from navetted.toml"
              className="w-full px-3 py-2 text-sm rounded-lg bg-(--color-surface-dim) border border-(--color-border) text-(--color-text) placeholder:text-(--color-text-muted)/50 focus:outline-none focus:border-(--color-accent) transition-colors"
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-(--color-text-muted) cursor-pointer">
            <input
              type="checkbox"
              checked={tls}
              onChange={(e) => setTls(e.target.checked)}
              className="accent-(--color-accent)"
            />
            Use TLS (wss://)
          </label>

          {status === "error" && (
            <p className="text-sm text-(--color-danger)">
              Connection rejected — check your token.
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!token || isConnecting}
              className="flex-1 px-4 py-2 text-sm font-medium rounded-lg bg-(--color-accent) text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isConnecting ? "Connecting..." : "Connect"}
            </button>
            <button
              type="button"
              onClick={() => setShowSave(!showSave)}
              className="px-3 py-2 text-sm rounded-lg border border-(--color-border) text-(--color-text-muted) hover:bg-(--color-surface-dim) transition-colors"
            >
              Save
            </button>
          </div>

          {showSave && (
            <div className="flex gap-2">
              <input
                type="text"
                value={configName}
                onChange={(e) => setConfigName(e.target.value)}
                placeholder="Config name"
                className="flex-1 px-3 py-2 text-sm rounded-lg bg-(--color-surface-dim) border border-(--color-border) text-(--color-text) focus:outline-none focus:border-(--color-accent) transition-colors"
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
              />
              <button
                type="button"
                onClick={handleSave}
                className="px-3 py-2 text-sm rounded-lg bg-(--color-accent) text-white hover:opacity-90 transition-opacity"
              >
                Save
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
