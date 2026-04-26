import { useEffect, useState } from "react";
import { useConnectionStore } from "../store/connectionStore";
import { useFeatureStore } from "../store/featureStore";
import { useSettingsStore } from "../store/settingsStore";
import type { NavetteWS } from "../lib/ws";
import type { ContainerInfo, DeviceEntry, McpServerInfo, NotifyConfig } from "../types";

type Tab = "general" | "notifications" | "devices" | "containers" | "mcp";

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
}

function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function truncateId(id: string): string {
  return id.length > 16 ? `${id.slice(0, 10)}…${id.slice(-4)}` : id;
}

// ── General Tab ───────────────────────────────────────────────────────────────

function GeneralTab() {
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);

  const options = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ] as const;

  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-3 text-sm font-medium text-(--color-text)">Theme</h3>
        <div className="flex gap-3">
          {options.map(({ value, label }) => (
            <label
              key={value}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-(--color-border) px-3 py-2 text-sm text-(--color-text) hover:bg-(--color-surface-dim) transition-colors"
            >
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => setTheme(value)}
                className="accent-(--color-accent)"
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Notifications Tab ─────────────────────────────────────────────────────────

function NotificationsTab({ ws }: { ws: NavetteWS }) {
  const notifyConfig = useFeatureStore((s) => s.notifyConfig);
  const setNotifyConfig = useFeatureStore((s) => s.setNotifyConfig);
  const testResult = useFeatureStore((s) => s.testNotificationResult);
  const setTestResult = useFeatureStore((s) => s.setTestNotificationResult);

  useEffect(() => {
    ws.send({ type: "get_notify_config" });
    const unsub = ws.onMessage((msg) => {
      if (msg.type === "notify_config") {
        setNotifyConfig(msg.config as NotifyConfig | null);
      }
      if (msg.type === "test_notification_result") {
        setTestResult(msg.ok === true ? "sent" : "failed");
      }
    });
    return unsub;
  }, [ws, setNotifyConfig, setTestResult]);

  function handleTest() {
    setTestResult("idle");
    ws.send({ type: "test_notification" });
  }

  return (
    <div className="space-y-4">
      {notifyConfig ? (
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-(--color-text-muted)">
              ntfy Topic
            </label>
            <p className="rounded-md bg-(--color-surface-dim) px-3 py-2 font-mono text-sm text-(--color-text)">
              {notifyConfig.topic}
            </p>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-(--color-text-muted)">
              Base URL
            </label>
            <p className="rounded-md bg-(--color-surface-dim) px-3 py-2 font-mono text-sm text-(--color-text)">
              {notifyConfig.base_url}
            </p>
          </div>
        </div>
      ) : (
        <p className="text-sm text-(--color-text-muted)">
          No notification configuration found.
        </p>
      )}
      <div className="flex items-center gap-3 pt-2">
        <button
          className="rounded-md bg-(--color-accent) px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          onClick={handleTest}
        >
          Test Notification
        </button>
        {testResult === "sent" && (
          <span className="text-sm text-(--color-success)">Sent successfully</span>
        )}
        {testResult === "failed" && (
          <span className="text-sm text-(--color-danger)">Send failed</span>
        )}
      </div>
    </div>
  );
}

// ── Devices Tab ───────────────────────────────────────────────────────────────

function DevicesTab({ ws }: { ws: NavetteWS }) {
  const devices = useFeatureStore((s) => s.devices);
  const setDevices = useFeatureStore((s) => s.setDevices);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  useEffect(() => {
    ws.send({ type: "list_devices" });
    const unsub = ws.onMessage((msg) => {
      if (msg.type === "devices_list" && Array.isArray(msg.devices)) {
        setDevices(msg.devices as DeviceEntry[]);
      }
    });
    return unsub;
  }, [ws, setDevices]);

  function handleRevoke(deviceId: string) {
    ws.send({ type: "revoke_device", device_id: deviceId });
  }

  function handleRenameStart(device: DeviceEntry) {
    setRenamingId(device.device_id);
    setRenameValue(device.name);
  }

  function handleRenameSubmit(deviceId: string) {
    if (renameValue.trim()) {
      ws.send({ type: "rename_device", device_id: deviceId, name: renameValue.trim() });
    }
    setRenamingId(null);
    setRenameValue("");
  }

  return (
    <div className="space-y-3">
      {devices.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)">No devices paired.</p>
      ) : (
        devices.map((device) => (
          <div
            key={device.device_id}
            className="rounded-lg border border-(--color-border) bg-(--color-surface) p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                {renamingId === device.device_id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleRenameSubmit(device.device_id);
                    }}
                    className="flex gap-2"
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="flex-1 rounded border border-(--color-border) bg-(--color-surface-dim) px-2 py-1 text-sm text-(--color-text) focus:outline-none focus:ring-1 focus:ring-(--color-accent)"
                    />
                    <button
                      type="submit"
                      className="rounded bg-(--color-accent) px-2 py-1 text-xs text-white hover:opacity-90"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setRenamingId(null)}
                      className="rounded border border-(--color-border) px-2 py-1 text-xs text-(--color-text-muted) hover:bg-(--color-surface-dim)"
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <p className="truncate text-sm font-medium text-(--color-text)">
                    {device.name}
                  </p>
                )}
                <p className="mt-0.5 font-mono text-xs text-(--color-text-muted)">
                  {truncateId(device.device_id)}
                </p>
                <p className="mt-1 text-xs text-(--color-text-muted)">
                  Paired: {formatDate(device.paired_at)} &middot; Last seen:{" "}
                  {formatDate(device.last_seen)}
                </p>
                {device.revoked && (
                  <span className="mt-1 inline-block rounded bg-(--color-danger)/20 px-1.5 py-0.5 text-xs text-(--color-danger)">
                    Revoked
                  </span>
                )}
              </div>
              {!device.revoked && renamingId !== device.device_id && (
                <div className="flex gap-2">
                  <button
                    className="rounded border border-(--color-border) px-2 py-1 text-xs text-(--color-text-muted) hover:bg-(--color-surface-dim) transition-colors"
                    onClick={() => handleRenameStart(device)}
                  >
                    Rename
                  </button>
                  <button
                    className="rounded border border-(--color-danger)/50 px-2 py-1 text-xs text-(--color-danger) hover:bg-(--color-danger)/10 transition-colors"
                    onClick={() => handleRevoke(device.device_id)}
                  >
                    Revoke
                  </button>
                </div>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Containers Tab ────────────────────────────────────────────────────────────

function ContainersTab({ ws }: { ws: NavetteWS }) {
  const containers = useFeatureStore((s) => s.containers);
  const setContainers = useFeatureStore((s) => s.setContainers);

  useEffect(() => {
    ws.send({ type: "list_containers" });
    const unsub = ws.onMessage((msg) => {
      if (msg.type === "containers_list" && Array.isArray(msg.containers)) {
        setContainers(msg.containers as ContainerInfo[]);
      }
    });
    return unsub;
  }, [ws, setContainers]);

  return (
    <div className="space-y-3">
      {containers.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)">No containers found.</p>
      ) : (
        containers.map((container) => (
          <div
            key={container.name}
            className="rounded-lg border border-(--color-border) bg-(--color-surface) p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-sm text-(--color-text)">
                {container.display ?? container.name}
              </p>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  container.status === "running"
                    ? "bg-(--color-success)/20 text-(--color-success)"
                    : "bg-(--color-surface-dim) text-(--color-text-muted)"
                }`}
              >
                {container.status}
              </span>
            </div>
            <p className="mt-1 font-mono text-xs text-(--color-text-muted)">
              {container.image}
            </p>
          </div>
        ))
      )}
    </div>
  );
}

// ── MCP Servers Tab ───────────────────────────────────────────────────────────

function McpServersTab({ ws }: { ws: NavetteWS }) {
  const mcpServers = useFeatureStore((s) => s.mcpServers);
  const setMcpServers = useFeatureStore((s) => s.setMcpServers);

  useEffect(() => {
    ws.send({ type: "list_mcp_servers" });
    const unsub = ws.onMessage((msg) => {
      if (msg.type === "mcp_servers_list" && Array.isArray(msg.servers)) {
        setMcpServers(msg.servers as McpServerInfo[]);
      }
    });
    return unsub;
  }, [ws, setMcpServers]);

  return (
    <div className="space-y-3">
      {mcpServers.length === 0 ? (
        <p className="text-sm text-(--color-text-muted)">No MCP servers configured.</p>
      ) : (
        mcpServers.map((server) => (
          <div
            key={server.name}
            className="rounded-lg border border-(--color-border) bg-(--color-surface) p-4"
          >
            <p className="font-medium text-sm text-(--color-text)">{server.name}</p>
            <p className="mt-1 font-mono text-xs text-(--color-text-muted)">
              {server.command}
            </p>
            <div className="mt-2 flex gap-3 text-xs text-(--color-text-muted)">
              <span>{server.args_count} arg{server.args_count !== 1 ? "s" : ""}</span>
              <span>{server.env_count} env var{server.env_count !== 1 ? "s" : ""}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Main Dialog ───────────────────────────────────────────────────────────────

const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "General" },
  { id: "notifications", label: "Notifications" },
  { id: "devices", label: "Devices" },
  { id: "containers", label: "Containers" },
  { id: "mcp", label: "MCP Servers" },
];

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const ws = useConnectionStore((s) => s.ws);
  const [activeTab, setActiveTab] = useState<Tab>("general");

  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-2xl flex-col rounded-xl bg-(--color-surface) shadow-2xl"
        style={{ maxHeight: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-(--color-border) px-6 py-4">
          <h2 className="text-base font-semibold text-(--color-text)">Settings</h2>
          <button
            className="text-(--color-text-muted) hover:text-(--color-text) transition-colors"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* Sidebar tabs */}
          <nav className="flex w-44 flex-shrink-0 flex-col gap-1 border-r border-(--color-border) p-3">
            {TABS.map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  activeTab === id
                    ? "bg-(--color-accent-light) font-medium text-(--color-accent)"
                    : "text-(--color-text-muted) hover:bg-(--color-surface-dim) hover:text-(--color-text)"
                }`}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-6">
            {activeTab === "general" && <GeneralTab />}
            {activeTab === "notifications" && <NotificationsTab ws={ws} />}
            {activeTab === "devices" && <DevicesTab ws={ws} />}
            {activeTab === "containers" && <ContainersTab ws={ws} />}
            {activeTab === "mcp" && <McpServersTab ws={ws} />}
          </div>
        </div>
      </div>
    </div>
  );
}
