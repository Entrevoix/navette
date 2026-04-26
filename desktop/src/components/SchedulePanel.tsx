import { useState, useEffect } from "react";
import { useConnectionStore } from "../store/connectionStore";
import { useFeatureStore } from "../store/featureStore";
import type { ScheduledSessionInfo } from "../types";

interface ScheduleForm {
  prompt: string;
  scheduledAt: string;
}

const EMPTY_FORM: ScheduleForm = { prompt: "", scheduledAt: "" };

function formatScheduledTime(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isFuture(ts: number): boolean {
  return ts * 1000 > Date.now();
}

function localDatetimeDefaultValue(): string {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  return d.toISOString().slice(0, 16);
}

export function SchedulePanel() {
  const ws = useConnectionStore((s) => s.ws);
  const scheduledSessions = useFeatureStore((s) => s.scheduledSessions);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<ScheduleForm>(EMPTY_FORM);

  useEffect(() => {
    ws.send({ type: "list_scheduled_sessions" });
  }, [ws]);

  function handleSchedule() {
    if (!form.prompt.trim() || !form.scheduledAt) return;
    const scheduledAt = Math.floor(new Date(form.scheduledAt).getTime() / 1000);
    ws.send({ type: "schedule_session", prompt: form.prompt.trim(), scheduled_at: scheduledAt });
    setShowForm(false);
    setForm(EMPTY_FORM);
  }

  function handleCancel(id: string) {
    ws.send({ type: "cancel_scheduled_session", id });
  }

  function handleShowForm() {
    setForm({ prompt: "", scheduledAt: localDatetimeDefaultValue() });
    setShowForm(true);
  }

  const upcoming = scheduledSessions.filter((s) => !s.fired);
  const fired = scheduledSessions.filter((s) => s.fired);

  return (
    <div className="flex flex-col h-full bg-(--color-surface)">
      {/* Header */}
      <div className="px-4 py-3 border-b border-(--color-border) flex items-center justify-between">
        <h2 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide">
          Scheduled Sessions
        </h2>
        <button
          onClick={handleShowForm}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-(--color-accent) text-white hover:opacity-90 transition-opacity"
        >
          + Schedule
        </button>
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="p-4 border-b border-(--color-border) bg-(--color-surface-dim) space-y-3">
          <p className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide">
            Schedule New Session
          </p>
          <textarea
            value={form.prompt}
            onChange={(e) => setForm({ ...form, prompt: e.target.value })}
            placeholder="Prompt for Claude…"
            rows={3}
            className="w-full px-3 py-2 text-sm rounded-lg bg-(--color-surface-bright) border border-(--color-border) text-(--color-text) placeholder:text-(--color-text-muted)/50 focus:outline-none focus:border-(--color-accent) transition-colors resize-none"
            autoFocus
          />
          <div>
            <label className="block text-xs font-medium text-(--color-text-muted) mb-1">
              Scheduled time
            </label>
            <input
              type="datetime-local"
              value={form.scheduledAt}
              onChange={(e) => setForm({ ...form, scheduledAt: e.target.value })}
              className="w-full px-3 py-2 text-sm rounded-lg bg-(--color-surface-bright) border border-(--color-border) text-(--color-text) focus:outline-none focus:border-(--color-accent) transition-colors"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleSchedule}
              disabled={!form.prompt.trim() || !form.scheduledAt}
              className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-(--color-accent) text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              Schedule
            </button>
            <button
              onClick={() => setShowForm(false)}
              className="px-3 py-1.5 text-xs rounded-lg border border-(--color-border) text-(--color-text-muted) hover:bg-(--color-surface-bright) transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {scheduledSessions.length === 0 && (
          <p className="text-sm text-(--color-text-muted) text-center py-8">
            No scheduled sessions
          </p>
        )}

        {upcoming.length > 0 && (
          <>
            {upcoming.length < scheduledSessions.length && (
              <p className="px-2 pt-2 text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide">
                Upcoming
              </p>
            )}
            {upcoming.map((session) => (
              <ScheduledItem
                key={session.id}
                session={session}
                onCancel={handleCancel}
              />
            ))}
          </>
        )}

        {fired.length > 0 && (
          <>
            <p className="px-2 pt-3 text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide">
              Fired
            </p>
            {fired.map((session) => (
              <ScheduledItem
                key={session.id}
                session={session}
                onCancel={handleCancel}
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

interface ScheduledItemProps {
  session: ScheduledSessionInfo;
  onCancel: (id: string) => void;
}

function ScheduledItem({ session, onCancel }: ScheduledItemProps) {
  const isPast = !isFuture(session.scheduled_at);
  const isOverdue = !session.fired && isPast;

  return (
    <div
      className={`rounded-lg border px-3 py-2.5 ${
        session.fired
          ? "border-(--color-border) bg-(--color-surface-dim) opacity-60"
          : isOverdue
            ? "border-(--color-warning)/40 bg-(--color-warning)/5"
            : "border-(--color-border) bg-(--color-surface-bright)"
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p
            className={`text-sm text-(--color-text) ${
              session.fired ? "line-through text-(--color-text-muted)" : ""
            }`}
          >
            {session.prompt}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className={`text-xs ${
                session.fired
                  ? "text-(--color-text-muted)"
                  : isOverdue
                    ? "text-(--color-warning)"
                    : "text-(--color-text-muted)"
              }`}
            >
              {formatScheduledTime(session.scheduled_at)}
            </span>
            {session.fired && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-(--color-success)/15 text-(--color-success)">
                Fired
              </span>
            )}
            {isOverdue && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-(--color-warning)/15 text-(--color-warning)">
                Overdue
              </span>
            )}
          </div>
        </div>
        {!session.fired && (
          <button
            onClick={() => onCancel(session.id)}
            className="shrink-0 px-2.5 py-1 text-xs rounded-lg border border-(--color-border) text-(--color-text-muted) hover:border-(--color-danger)/40 hover:text-(--color-danger) transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}
