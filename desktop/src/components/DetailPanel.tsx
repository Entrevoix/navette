import { useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import { useApprovalStore } from "../store/approvalStore";
import { DiffView } from "./DiffView";
import type { ToolUseBlock } from "../types";

interface DetailPanelProps {
  selectedToolUse: { block: ToolUseBlock; result?: string } | null;
}

type Tab = "detail" | "tokens" | "policies";

export function DetailPanel({ selectedToolUse }: DetailPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>(
    selectedToolUse ? "detail" : "tokens",
  );
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const policies = useApprovalStore((s) => s.approvalPolicies);

  const activeSession = sessions.find(
    (s) => s.session_id === activeSessionId,
  );

  const tabs: { id: Tab; label: string }[] = [
    { id: "detail", label: "Detail" },
    { id: "tokens", label: "Tokens" },
    { id: "policies", label: "Policies" },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex border-b border-(--color-border)">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex-1 px-3 py-2 text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? "text-(--color-accent) border-b-2 border-(--color-accent)"
                : "text-(--color-text-muted) hover:text-(--color-text)"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === "detail" && (
          <DetailContent selectedToolUse={selectedToolUse} />
        )}
        {activeTab === "tokens" && <TokensContent session={activeSession} />}
        {activeTab === "policies" && <PoliciesContent policies={policies} />}
      </div>
    </div>
  );
}

function DetailContent({
  selectedToolUse,
}: {
  selectedToolUse: DetailPanelProps["selectedToolUse"];
}) {
  if (!selectedToolUse) {
    return (
      <p className="text-sm text-(--color-text-muted) text-center py-8">
        Click a tool use in the conversation to see details
      </p>
    );
  }

  const { block, result } = selectedToolUse;
  const isDiff =
    result &&
    (result.includes("@@") ||
      result.includes("--- ") ||
      result.includes("+++ "));

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide mb-1">
          Tool
        </h3>
        <p className="text-sm font-mono text-(--color-accent)">{block.name}</p>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide mb-1">
          Input
        </h3>
        <pre className="text-xs font-mono p-2 rounded-lg bg-(--color-surface-dim) border border-(--color-border) whitespace-pre-wrap break-all overflow-x-auto max-h-64 overflow-y-auto">
          {JSON.stringify(block.input, null, 2)}
        </pre>
      </div>

      {result && (
        <div>
          <h3 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide mb-1">
            Result
          </h3>
          {isDiff ? (
            <DiffView content={result} />
          ) : (
            <pre className="text-xs font-mono p-2 rounded-lg bg-(--color-surface-dim) border border-(--color-border) whitespace-pre-wrap break-all overflow-x-auto max-h-96 overflow-y-auto">
              {result}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function TokensContent({
  session,
}: {
  session:
    | {
        input_tokens?: number;
        output_tokens?: number;
        cache_read_tokens?: number;
        prompt?: string;
        agent_type?: string;
        container?: string | null;
        started_at?: number;
      }
    | undefined;
}) {
  if (!session) {
    return (
      <p className="text-sm text-(--color-text-muted) text-center py-8">
        No active session
      </p>
    );
  }

  const input = session.input_tokens || 0;
  const output = session.output_tokens || 0;
  const cache = session.cache_read_tokens || 0;
  const total = input + output;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide mb-2">
          Token Usage
        </h3>
        <div className="space-y-2">
          <TokenBar label="Input" value={input} max={total || 1} color="accent" />
          <TokenBar
            label="Output"
            value={output}
            max={total || 1}
            color="success"
          />
          {cache > 0 && (
            <TokenBar
              label="Cache Read"
              value={cache}
              max={total || 1}
              color="info"
            />
          )}
        </div>
      </div>

      <div>
        <h3 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide mb-2">
          Session Info
        </h3>
        <dl className="space-y-1 text-xs">
          <div className="flex justify-between">
            <dt className="text-(--color-text-muted)">Agent</dt>
            <dd>{session.agent_type || "claude"}</dd>
          </div>
          {session.container && (
            <div className="flex justify-between">
              <dt className="text-(--color-text-muted)">Container</dt>
              <dd className="font-mono">{session.container}</dd>
            </div>
          )}
          {session.started_at && (
            <div className="flex justify-between">
              <dt className="text-(--color-text-muted)">Started</dt>
              <dd>{new Date(session.started_at * 1000).toLocaleTimeString()}</dd>
            </div>
          )}
        </dl>
      </div>
    </div>
  );
}

function TokenBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.min(100, (value / max) * 100);
  const formatted =
    value >= 1000 ? `${(value / 1000).toFixed(1)}k` : String(value);

  return (
    <div>
      <div className="flex justify-between text-xs mb-0.5">
        <span className="text-(--color-text-muted)">{label}</span>
        <span className="font-mono">{formatted}</span>
      </div>
      <div className="h-1.5 rounded-full bg-(--color-surface-dim)">
        <div
          className={`h-full rounded-full bg-(--color-${color}) transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function PoliciesContent({
  policies,
}: {
  policies: Array<{
    tool_name: string;
    action: string;
    updated_at: number;
  }>;
}) {
  if (policies.length === 0) {
    return (
      <p className="text-sm text-(--color-text-muted) text-center py-8">
        No approval policies configured
      </p>
    );
  }

  return (
    <div className="space-y-1">
      <h3 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide mb-2">
        Approval Policies
      </h3>
      {policies.map((p) => (
        <div
          key={p.tool_name}
          className="flex items-center justify-between px-2 py-1.5 rounded-lg hover:bg-(--color-surface-dim) transition-colors"
        >
          <span className="text-sm font-mono">{p.tool_name}</span>
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              p.action === "allow"
                ? "bg-(--color-success)/15 text-(--color-success)"
                : p.action === "deny"
                  ? "bg-(--color-danger)/15 text-(--color-danger)"
                  : "bg-(--color-warning)/15 text-(--color-warning)"
            }`}
          >
            {p.action}
          </span>
        </div>
      ))}
    </div>
  );
}
