export interface KeyboardCallbacks {
  onNewSession: () => void;
  onToggleSettings: () => void;
  onToggleShortcuts: () => void;
}

export function setupKeyboardShortcuts(
  callbacks: KeyboardCallbacks,
): () => void {
  function handleKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    if (tagName === "input" || tagName === "textarea") return;

    if (e.ctrlKey && e.key === "n") {
      e.preventDefault();
      callbacks.onNewSession();
      return;
    }

    if (e.ctrlKey && e.key === ",") {
      e.preventDefault();
      callbacks.onToggleSettings();
      return;
    }

    if (e.ctrlKey && e.key === "/") {
      e.preventDefault();
      callbacks.onToggleShortcuts();
      return;
    }
  }

  document.addEventListener("keydown", handleKeyDown);
  return () => document.removeEventListener("keydown", handleKeyDown);
}
