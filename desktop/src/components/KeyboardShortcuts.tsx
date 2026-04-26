import { useEffect } from "react";

interface KeyboardShortcutsProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS: { combo: string; description: string }[] = [
  { combo: "Ctrl+N", description: "New session" },
  { combo: "Ctrl+K", description: "Command palette (coming soon)" },
  { combo: "Ctrl+,", description: "Open settings" },
  { combo: "Ctrl+/", description: "Toggle keyboard shortcuts" },
  { combo: "Escape", description: "Close dialogs" },
];

export function KeyboardShortcuts({ open, onClose }: KeyboardShortcutsProps) {
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
        className="w-full max-w-md rounded-lg bg-(--color-surface) shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-(--color-border) px-5 py-4">
          <h2 className="text-base font-semibold text-(--color-text)">
            Keyboard Shortcuts
          </h2>
          <button
            className="text-(--color-text-muted) hover:text-(--color-text) transition-colors"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="p-5">
          <table className="w-full">
            <thead>
              <tr>
                <th className="pb-2 text-left text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">
                  Key
                </th>
                <th className="pb-2 text-left text-xs font-medium uppercase tracking-wide text-(--color-text-muted)">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-(--color-border)">
              {SHORTCUTS.map(({ combo, description }) => (
                <tr key={combo}>
                  <td className="py-2 pr-4">
                    <kbd className="rounded bg-(--color-surface-dim) px-2 py-0.5 font-mono text-sm text-(--color-text)">
                      {combo}
                    </kbd>
                  </td>
                  <td className="py-2 text-sm text-(--color-text)">
                    {description}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
