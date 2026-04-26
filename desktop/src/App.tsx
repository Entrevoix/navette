import { useEffect, useState } from "react";
import { useConnectionStore } from "./store/connectionStore";
import { useSessionStore } from "./store/sessionStore";
import { useSettingsStore } from "./store/settingsStore";
import { setupDispatch } from "./lib/dispatch";
import { setupKeyboardShortcuts } from "./lib/keyboard";
import { ConnectForm } from "./components/ConnectForm";
import { Layout } from "./components/Layout";
import { SessionSidebar } from "./components/SessionSidebar";
import { ConversationPanel } from "./components/ConversationPanel";
import { DetailPanel } from "./components/DetailPanel";
import { StatusBar } from "./components/StatusBar";
import { FileBrowser } from "./components/FileBrowser";
import { PromptLibrary } from "./components/PromptLibrary";
import { SecretsVault } from "./components/SecretsVault";
import { SchedulePanel } from "./components/SchedulePanel";
import { SessionHistory } from "./components/SessionHistory";
import { SkillsBrowser } from "./components/SkillsBrowser";
import { SettingsDialog } from "./components/SettingsDialog";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import type { ToolUseBlock } from "./types";

type View =
  | "conversation"
  | "files"
  | "prompts"
  | "secrets"
  | "schedule"
  | "history"
  | "skills";

const NAV_ITEMS: { id: View; label: string; shortLabel: string }[] = [
  { id: "conversation", label: "Conversation", shortLabel: "Chat" },
  { id: "files", label: "Files", shortLabel: "Files" },
  { id: "prompts", label: "Prompts", shortLabel: "Prompts" },
  { id: "secrets", label: "Secrets", shortLabel: "Secrets" },
  { id: "schedule", label: "Schedule", shortLabel: "Sched" },
  { id: "history", label: "History", shortLabel: "Hist" },
  { id: "skills", label: "Skills", shortLabel: "Skills" },
];

export default function App() {
  const status = useConnectionStore((s) => s.status);
  const [view, setView] = useState<View>("conversation");
  const [showSettings, setShowSettings] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [selectedToolUse, setSelectedToolUse] = useState<{
    block: ToolUseBlock;
    result?: string;
  } | null>(null);

  const theme = useSettingsStore((s) => s.theme);

  useEffect(() => {
    const unsub = setupDispatch();
    return unsub;
  }, []);

  useEffect(() => {
    if (theme === "system") {
      document.documentElement.removeAttribute("data-theme");
    } else {
      document.documentElement.setAttribute("data-theme", theme);
    }
  }, [theme]);

  useEffect(() => {
    return setupKeyboardShortcuts({
      onNewSession: () => setView("conversation"),
      onToggleSettings: () => setShowSettings((v) => !v),
      onToggleShortcuts: () => setShowShortcuts((v) => !v),
    });
  }, []);

  const activeSessionId = useSessionStore((s) => s.activeSessionId);

  useEffect(() => {
    setSelectedToolUse(null);
  }, [activeSessionId]);

  if (status !== "connected") {
    return <ConnectForm />;
  }

  function handleUsePrompt(body: string) {
    setView("conversation");
    const ws = useConnectionStore.getState().ws;
    const sid = useSessionStore.getState().activeSessionId;
    if (sid) {
      ws.send({ type: "user_input", session_id: sid, text: body });
    }
  }

  function renderMain(): React.ReactNode {
    switch (view) {
      case "files":
        return <FileBrowser />;
      case "prompts":
        return <PromptLibrary onUsePrompt={handleUsePrompt} />;
      case "secrets":
        return <SecretsVault />;
      case "schedule":
        return <SchedulePanel />;
      case "history":
        return <SessionHistory />;
      case "skills":
        return <SkillsBrowser />;
      default:
        return (
          <ConversationPanel
            onSelectToolUse={(block, result) =>
              setSelectedToolUse({ block, result })
            }
          />
        );
    }
  }

  return (
    <>
      <Layout
        sidebar={
          <div className="flex flex-col h-full">
            <nav className="flex flex-wrap gap-1 px-2 py-2 border-b border-(--color-border)">
              {NAV_ITEMS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setView(item.id)}
                  className={`px-2 py-1 text-xs rounded-md transition-colors ${
                    view === item.id
                      ? "bg-(--color-accent) text-white"
                      : "text-(--color-text-muted) hover:bg-(--color-surface-bright)"
                  }`}
                  title={item.label}
                >
                  {item.shortLabel}
                </button>
              ))}
              <button
                onClick={() => setShowSettings(true)}
                className="px-2 py-1 text-xs rounded-md text-(--color-text-muted) hover:bg-(--color-surface-bright) transition-colors ml-auto"
                title="Settings (Ctrl+,)"
              >
                Settings
              </button>
            </nav>
            {view === "conversation" && <SessionSidebar />}
          </div>
        }
        main={renderMain()}
        detail={<DetailPanel selectedToolUse={selectedToolUse} />}
        statusBar={<StatusBar />}
      />
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
      <KeyboardShortcuts open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </>
  );
}
