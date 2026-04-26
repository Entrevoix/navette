import { useState, useEffect } from "react";
import { useConnectionStore } from "../store/connectionStore";
import { useFeatureStore } from "../store/featureStore";
import type { SavedPrompt } from "../types";

interface PromptLibraryProps {
  onUsePrompt?: (body: string) => void;
}

type FormMode = "new" | "edit";

interface PromptForm {
  title: string;
  body: string;
  tags: string;
}

const EMPTY_FORM: PromptForm = { title: "", body: "", tags: "" };

export function PromptLibrary({ onUsePrompt }: PromptLibraryProps) {
  const ws = useConnectionStore((s) => s.ws);
  const savedPrompts = useFeatureStore((s) => s.savedPrompts);

  const [showForm, setShowForm] = useState(false);
  const [formMode, setFormMode] = useState<FormMode>("new");
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<PromptForm>(EMPTY_FORM);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    ws.send({ type: "list_prompts" });
  }, [ws]);

  function handleSave() {
    if (!form.title.trim() || !form.body.trim()) return;
    const tags = form.tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    if (formMode === "edit" && editId) {
      ws.send({ type: "update_prompt", id: editId, title: form.title.trim(), body: form.body.trim(), tags });
    } else {
      ws.send({ type: "save_prompt", title: form.title.trim(), body: form.body.trim(), tags });
    }
    setShowForm(false);
    setForm(EMPTY_FORM);
    setEditId(null);
  }

  function handleEdit(prompt: SavedPrompt) {
    setFormMode("edit");
    setEditId(prompt.id);
    setForm({ title: prompt.title, body: prompt.body, tags: prompt.tags.join(", ") });
    setShowForm(true);
  }

  function handleDelete(id: string) {
    ws.send({ type: "delete_prompt", id });
  }

  function handleNew() {
    setFormMode("new");
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function handleCancel() {
    setShowForm(false);
    setForm(EMPTY_FORM);
    setEditId(null);
  }

  return (
    <div className="flex flex-col h-full bg-(--color-surface)">
      {/* Header */}
      <div className="px-4 py-3 border-b border-(--color-border) flex items-center justify-between">
        <h2 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide">
          Prompt Library
        </h2>
        <button
          onClick={handleNew}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-(--color-accent) text-white hover:opacity-90 transition-opacity"
        >
          + New Prompt
        </button>
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="p-4 border-b border-(--color-border) bg-(--color-surface-dim) space-y-3">
          <p className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide">
            {formMode === "edit" ? "Edit Prompt" : "New Prompt"}
          </p>
          <input
            type="text"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="Title"
            className="w-full px-3 py-2 text-sm rounded-lg bg-(--color-surface-bright) border border-(--color-border) text-(--color-text) placeholder:text-(--color-text-muted)/50 focus:outline-none focus:border-(--color-accent) transition-colors"
            autoFocus
          />
          <textarea
            value={form.body}
            onChange={(e) => setForm({ ...form, body: e.target.value })}
            placeholder="Prompt body…"
            rows={4}
            className="w-full px-3 py-2 text-sm rounded-lg bg-(--color-surface-bright) border border-(--color-border) text-(--color-text) placeholder:text-(--color-text-muted)/50 focus:outline-none focus:border-(--color-accent) transition-colors resize-none"
          />
          <input
            type="text"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="Tags (comma-separated)"
            className="w-full px-3 py-2 text-sm rounded-lg bg-(--color-surface-bright) border border-(--color-border) text-(--color-text) placeholder:text-(--color-text-muted)/50 focus:outline-none focus:border-(--color-accent) transition-colors"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!form.title.trim() || !form.body.trim()}
              className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-(--color-accent) text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {formMode === "edit" ? "Update" : "Save"}
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 text-xs rounded-lg border border-(--color-border) text-(--color-text-muted) hover:bg-(--color-surface-bright) transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Prompt list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {savedPrompts.length === 0 && (
          <p className="text-sm text-(--color-text-muted) text-center py-8">
            No saved prompts
          </p>
        )}
        {savedPrompts.map((prompt) => {
          const isExpanded = expandedId === prompt.id;
          return (
            <div
              key={prompt.id}
              className="rounded-lg border border-(--color-border) bg-(--color-surface-bright) overflow-hidden"
            >
              <button
                className="w-full text-left px-3 py-2.5 hover:bg-(--color-surface-dim) transition-colors"
                onClick={() => setExpandedId(isExpanded ? null : prompt.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-(--color-text) truncate">
                    {prompt.title}
                  </span>
                  <span className="text-xs text-(--color-text-muted) shrink-0 mt-0.5">
                    {isExpanded ? "▲" : "▼"}
                  </span>
                </div>
                {prompt.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {prompt.tags.map((tag) => (
                      <span
                        key={tag}
                        className="px-1.5 py-0.5 text-xs rounded bg-(--color-accent-light) text-(--color-accent)"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {!isExpanded && (
                  <p className="text-xs text-(--color-text-muted) mt-1 line-clamp-2">
                    {prompt.body}
                  </p>
                )}
              </button>

              {isExpanded && (
                <div className="px-3 pb-3 space-y-2 border-t border-(--color-border)">
                  <pre className="mt-2 text-xs text-(--color-text) whitespace-pre-wrap font-sans leading-relaxed">
                    {prompt.body}
                  </pre>
                  <div className="flex gap-2 pt-1">
                    {onUsePrompt && (
                      <button
                        onClick={() => onUsePrompt(prompt.body)}
                        className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-(--color-accent) text-white hover:opacity-90 transition-opacity"
                      >
                        Use Prompt
                      </button>
                    )}
                    <button
                      onClick={() => handleEdit(prompt)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-(--color-border) text-(--color-text-muted) hover:bg-(--color-surface-dim) transition-colors"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(prompt.id)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-(--color-danger)/30 text-(--color-danger) hover:bg-(--color-danger)/10 transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
