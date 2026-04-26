import { useState, useEffect } from "react";
import { useConnectionStore } from "../store/connectionStore";
import { useFeatureStore } from "../store/featureStore";

interface SecretForm {
  name: string;
  value: string;
}

const EMPTY_FORM: SecretForm = { name: "", value: "" };

export function SecretsVault() {
  const ws = useConnectionStore((s) => s.ws);
  const secrets = useFeatureStore((s) => s.secrets);

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<SecretForm>(EMPTY_FORM);

  useEffect(() => {
    ws.send({ type: "list_secrets" });
  }, [ws]);

  function handleSave() {
    if (!form.name.trim() || !form.value.trim()) return;
    ws.send({ type: "set_secret", name: form.name.trim(), value: form.value.trim() });
    setShowForm(false);
    setForm(EMPTY_FORM);
  }

  function handleDelete(name: string) {
    ws.send({ type: "delete_secret", name });
  }

  function handleCancel() {
    setShowForm(false);
    setForm(EMPTY_FORM);
  }

  return (
    <div className="flex flex-col h-full bg-(--color-surface)">
      {/* Header */}
      <div className="px-4 py-3 border-b border-(--color-border) flex items-center justify-between">
        <h2 className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide">
          Secrets Vault
        </h2>
        <button
          onClick={() => setShowForm(true)}
          className="px-3 py-1.5 text-xs font-medium rounded-lg bg-(--color-accent) text-white hover:opacity-90 transition-opacity"
        >
          + Add Secret
        </button>
      </div>

      {/* Inline form */}
      {showForm && (
        <div className="p-4 border-b border-(--color-border) bg-(--color-surface-dim) space-y-3">
          <p className="text-xs font-semibold text-(--color-text-muted) uppercase tracking-wide">
            Add Secret
          </p>
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="Secret name (e.g. OPENAI_API_KEY)"
            className="w-full px-3 py-2 text-sm rounded-lg bg-(--color-surface-bright) border border-(--color-border) text-(--color-text) placeholder:text-(--color-text-muted)/50 focus:outline-none focus:border-(--color-accent) transition-colors font-mono"
            autoFocus
            autoComplete="off"
          />
          <input
            type="password"
            value={form.value}
            onChange={(e) => setForm({ ...form, value: e.target.value })}
            placeholder="Secret value"
            className="w-full px-3 py-2 text-sm rounded-lg bg-(--color-surface-bright) border border-(--color-border) text-(--color-text) placeholder:text-(--color-text-muted)/50 focus:outline-none focus:border-(--color-accent) transition-colors"
            autoComplete="new-password"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!form.name.trim() || !form.value.trim()}
              className="flex-1 px-3 py-1.5 text-xs font-medium rounded-lg bg-(--color-accent) text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              Save
            </button>
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 text-xs rounded-lg border border-(--color-border) text-(--color-text-muted) hover:bg-(--color-surface-bright) transition-colors"
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-(--color-text-muted) opacity-70">
            Secrets are encrypted at rest with AES-256-GCM.
          </p>
        </div>
      )}

      {/* Secrets list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {secrets.length === 0 && (
          <p className="text-sm text-(--color-text-muted) text-center py-8">
            No secrets stored
          </p>
        )}
        {secrets.map((secret) => (
          <div
            key={secret.name}
            className="flex items-center gap-3 px-3 py-2.5 rounded-lg border border-(--color-border) bg-(--color-surface-bright)"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-(--color-text) font-mono truncate">
                {secret.name}
              </p>
              <p className="text-xs text-(--color-text-muted) mt-0.5 font-mono">
                {secret.masked}
              </p>
            </div>
            <button
              onClick={() => handleDelete(secret.name)}
              className="shrink-0 px-2.5 py-1 text-xs rounded-lg border border-(--color-danger)/30 text-(--color-danger) hover:bg-(--color-danger)/10 transition-colors"
            >
              Delete
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
