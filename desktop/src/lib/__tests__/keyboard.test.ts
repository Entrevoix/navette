import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setupKeyboardShortcuts } from "../keyboard";

function fireKeydown(
  key: string,
  options: Partial<KeyboardEventInit> & { targetTag?: string } = {},
) {
  const { targetTag = "div", ...init } = options;
  const target = document.createElement(targetTag);
  const event = new KeyboardEvent("keydown", { key, bubbles: true, ...init });
  Object.defineProperty(event, "target", { value: target, configurable: true });
  document.dispatchEvent(event);
  return event;
}

describe("setupKeyboardShortcuts", () => {
  let onNewSession: (() => void) & ReturnType<typeof vi.fn>;
  let onToggleSettings: (() => void) & ReturnType<typeof vi.fn>;
  let onToggleShortcuts: (() => void) & ReturnType<typeof vi.fn>;
  let cleanup: () => void;

  beforeEach(() => {
    onNewSession = vi.fn() as typeof onNewSession;
    onToggleSettings = vi.fn() as typeof onToggleSettings;
    onToggleShortcuts = vi.fn() as typeof onToggleShortcuts;
    cleanup = setupKeyboardShortcuts({
      onNewSession,
      onToggleSettings,
      onToggleShortcuts,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("calls onNewSession when Ctrl+N is pressed", () => {
    fireKeydown("n", { ctrlKey: true });
    expect(onNewSession).toHaveBeenCalledTimes(1);
  });

  it("calls onToggleSettings when Ctrl+, is pressed", () => {
    fireKeydown(",", { ctrlKey: true });
    expect(onToggleSettings).toHaveBeenCalledTimes(1);
  });

  it("calls onToggleShortcuts when Ctrl+/ is pressed", () => {
    fireKeydown("/", { ctrlKey: true });
    expect(onToggleShortcuts).toHaveBeenCalledTimes(1);
  });

  it("returns a cleanup function that removes the listener", () => {
    cleanup(); // call early
    fireKeydown("n", { ctrlKey: true });
    expect(onNewSession).not.toHaveBeenCalled();
    // Re-register so afterEach cleanup() call is a no-op double-remove (safe)
    cleanup = () => {};
  });

  it("ignores events when target is an input element", () => {
    fireKeydown("n", { ctrlKey: true, targetTag: "input" });
    expect(onNewSession).not.toHaveBeenCalled();
  });

  it("ignores events when target is a textarea element", () => {
    fireKeydown(",", { ctrlKey: true, targetTag: "textarea" });
    expect(onToggleSettings).not.toHaveBeenCalled();
  });

  it("does not call any callback for unrelated keys", () => {
    fireKeydown("x", { ctrlKey: true });
    expect(onNewSession).not.toHaveBeenCalled();
    expect(onToggleSettings).not.toHaveBeenCalled();
    expect(onToggleShortcuts).not.toHaveBeenCalled();
  });
});
