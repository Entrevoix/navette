import { useEffect, useRef, useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import { useApprovalStore } from "../store/approvalStore";
import { useConnectionStore } from "../store/connectionStore";
import { ApprovalBanner } from "./ApprovalBanner";
import { MessageBubble } from "./MessageBubble";
import type {
  AssistantEvent,
  ContentBlock,
  EventFrame,
  ToolResultEvent,
  ToolUseBlock,
} from "../types";

interface ConversationPanelProps {
  onSelectToolUse?: (block: ToolUseBlock, result?: string) => void;
}

export function ConversationPanel({ onSelectToolUse }: ConversationPanelProps) {
  const { events, activeSessionId, viewStartSeq } = useSessionStore();
  const pendingApprovals = useApprovalStore((s) => s.pendingApprovals);
  const ws = useConnectionStore((s) => s.ws);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [autoScroll, setAutoScroll] = useState(true);

  const filteredEvents = events.filter((e) => {
    if (e.seq < viewStartSeq) return false;
    const sid = (e.event as Record<string, unknown>).session_id as
      | string
      | undefined;
    if (activeSessionId && sid && sid !== activeSessionId) return false;
    return true;
  });

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredEvents.length, autoScroll]);

  function handleScroll() {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 100);
  }

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    if (activeSessionId) {
      ws.send({
        type: "user_input",
        session_id: activeSessionId,
        text,
      });
    }
    setInput("");
  }

  function findToolResult(toolUseId: string): string | undefined {
    const resultEvent = events.find(
      (e) =>
        e.event.type === "tool_result" &&
        (e.event as ToolResultEvent).tool_use_id === toolUseId,
    );
    return resultEvent
      ? (resultEvent.event as ToolResultEvent).content
      : undefined;
  }

  const sessionPending = pendingApprovals.filter(() => true);

  return (
    <div className="flex flex-col h-full">
      {/* Batch approval bar */}
      {sessionPending.length > 1 && (
        <div className="flex items-center justify-between px-4 py-2 bg-(--color-warning)/10 border-b border-(--color-warning)/30">
          <span className="text-sm font-medium text-(--color-warning)">
            {sessionPending.length} pending approvals
          </span>
          <div className="flex gap-2">
            <button
              onClick={() =>
                sessionPending.forEach((a) =>
                  ws.send({
                    type: "input",
                    tool_use_id: a.tool_use_id,
                    decision: "y",
                  }),
                )
              }
              className="px-3 py-1 text-xs font-medium rounded bg-(--color-success) text-white hover:opacity-90 transition-opacity"
            >
              Allow All
            </button>
            <button
              onClick={() =>
                sessionPending.forEach((a) =>
                  ws.send({
                    type: "input",
                    tool_use_id: a.tool_use_id,
                    decision: "n",
                  }),
                )
              }
              className="px-3 py-1 text-xs font-medium rounded bg-(--color-danger) text-white hover:opacity-90 transition-opacity"
            >
              Deny All
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
      >
        {filteredEvents.length === 0 && (
          <div className="flex items-center justify-center h-full">
            <p className="text-sm text-(--color-text-muted)">
              {activeSessionId
                ? "Waiting for events..."
                : "Select or start a session"}
            </p>
          </div>
        )}

        {filteredEvents.map((frame) => (
          <EventRow
            key={frame.seq}
            frame={frame}
            pendingApprovals={sessionPending}
            onSelectToolUse={onSelectToolUse}
            findToolResult={findToolResult}
          />
        ))}
      </div>

      {/* Input bar */}
      {activeSessionId && (
        <div className="border-t border-(--color-border) p-3">
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type a message..."
              className="flex-1 px-3 py-2 text-sm rounded-lg bg-(--color-surface-dim) border border-(--color-border) text-(--color-text) placeholder:text-(--color-text-muted)/50 focus:outline-none focus:border-(--color-accent) resize-none transition-colors"
              rows={1}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-(--color-accent) text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

interface EventRowProps {
  frame: EventFrame;
  pendingApprovals: Array<{ tool_use_id: string }>;
  onSelectToolUse?: (block: ToolUseBlock, result?: string) => void;
  findToolResult: (toolUseId: string) => string | undefined;
}

function EventRow({
  frame,
  pendingApprovals,
  onSelectToolUse,
  findToolResult,
}: EventRowProps) {
  const { event } = frame;

  if (event.type === "assistant") {
    const assistant = event as AssistantEvent;
    return (
      <div className="space-y-2">
        {assistant.message.content.map((block: ContentBlock, i: number) => {
          if (block.type === "text") {
            return <MessageBubble key={i} text={block.text} role="assistant" />;
          }
          if (block.type === "tool_use") {
            const toolBlock = block as ToolUseBlock;
            const isPending = pendingApprovals.some(
              (a) => a.tool_use_id === toolBlock.id,
            );
            const result = findToolResult(toolBlock.id);
            return (
              <div key={i}>
                <ToolUseCard
                  block={toolBlock}
                  isPending={isPending}
                  onClick={() => onSelectToolUse?.(toolBlock, result)}
                />
                {isPending && <ApprovalBanner toolUseId={toolBlock.id} />}
              </div>
            );
          }
          return null;
        })}
      </div>
    );
  }

  if (event.type === "tool_result") {
    const result = event as ToolResultEvent;
    const content = result.content;
    const truncated =
      content.length > 300 ? content.slice(0, 300) + "..." : content;
    return (
      <div className="ml-4 px-3 py-2 rounded-lg bg-(--color-surface-dim) border border-(--color-border) text-xs font-mono text-(--color-text-muted) whitespace-pre-wrap break-all">
        {truncated}
      </div>
    );
  }

  if (event.type === "user") {
    const userEvent = event as Record<string, unknown>;
    const message = userEvent.message as { content?: Array<{ text?: string }> };
    const text = message?.content?.[0]?.text;
    if (text) {
      return <MessageBubble text={text} role="user" />;
    }
  }

  if (event.type === "session_ended") {
    const ended = event as { ok: boolean };
    return (
      <div
        className={`px-3 py-2 rounded-lg text-sm text-center ${ended.ok ? "bg-(--color-success)/10 text-(--color-success)" : "bg-(--color-danger)/10 text-(--color-danger)"}`}
      >
        Session {ended.ok ? "completed" : "failed"}
      </div>
    );
  }

  return null;
}

function ToolUseCard({
  block,
  isPending,
  onClick,
}: {
  block: ToolUseBlock;
  isPending: boolean;
  onClick?: () => void;
}) {
  const inputPreview = JSON.stringify(block.input, null, 2);
  const truncated =
    inputPreview.length > 200
      ? inputPreview.slice(0, 200) + "..."
      : inputPreview;

  return (
    <div
      onClick={onClick}
      className={`ml-4 px-3 py-2 rounded-lg border text-sm cursor-pointer hover:bg-(--color-surface-dim) transition-colors ${
        isPending
          ? "border-(--color-warning)/50 bg-(--color-warning)/5"
          : "border-(--color-border) bg-(--color-surface-bright)"
      }`}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-xs font-mono font-medium text-(--color-accent)">
          {block.name}
        </span>
        {isPending && (
          <span className="text-xs text-(--color-warning) font-medium">
            Pending approval
          </span>
        )}
      </div>
      <pre className="text-xs text-(--color-text-muted) whitespace-pre-wrap break-all">
        {truncated}
      </pre>
    </div>
  );
}
