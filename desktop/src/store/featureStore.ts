import { create } from "zustand";
import type {
  ContainerInfo,
  DeviceEntry,
  EventFrame,
  McpServerInfo,
  PastSessionInfo,
  SavedPrompt,
  ScheduledSessionInfo,
  SearchResult,
  SecretEntry,
  SkillInfo,
  NotifyConfig,
} from "../types";

interface FeatureState {
  skills: SkillInfo[];
  pastSessions: PastSessionInfo[];
  sessionHistory: Record<string, EventFrame[]>;
  savedPrompts: SavedPrompt[];
  secrets: SecretEntry[];
  scheduledSessions: ScheduledSessionInfo[];
  containers: ContainerInfo[];
  mcpServers: McpServerInfo[];
  devices: DeviceEntry[];
  searchResults: SearchResult[];
  notifyConfig: NotifyConfig | null;
  testNotificationResult: "idle" | "sent" | "failed";

  setSkills: (skills: SkillInfo[]) => void;
  setPastSessions: (sessions: PastSessionInfo[]) => void;
  setSessionHistory: (sessionId: string, events: EventFrame[]) => void;
  setSavedPrompts: (prompts: SavedPrompt[]) => void;
  setSecrets: (secrets: SecretEntry[]) => void;
  setScheduledSessions: (sessions: ScheduledSessionInfo[]) => void;
  setContainers: (containers: ContainerInfo[]) => void;
  setMcpServers: (servers: McpServerInfo[]) => void;
  setDevices: (devices: DeviceEntry[]) => void;
  setSearchResults: (results: SearchResult[]) => void;
  setNotifyConfig: (config: NotifyConfig | null) => void;
  setTestNotificationResult: (result: "idle" | "sent" | "failed") => void;
}

export const useFeatureStore = create<FeatureState>()((set) => ({
  skills: [],
  pastSessions: [],
  sessionHistory: {},
  savedPrompts: [],
  secrets: [],
  scheduledSessions: [],
  containers: [],
  mcpServers: [],
  devices: [],
  searchResults: [],
  notifyConfig: null,
  testNotificationResult: "idle",

  setSkills: (skills) => set({ skills }),
  setPastSessions: (pastSessions) => set({ pastSessions }),
  setSessionHistory: (sessionId, events) =>
    set((state) => ({
      sessionHistory: { ...state.sessionHistory, [sessionId]: events },
    })),
  setSavedPrompts: (savedPrompts) => set({ savedPrompts }),
  setSecrets: (secrets) => set({ secrets }),
  setScheduledSessions: (scheduledSessions) => set({ scheduledSessions }),
  setContainers: (containers) => set({ containers }),
  setMcpServers: (mcpServers) => set({ mcpServers }),
  setDevices: (devices) => set({ devices }),
  setSearchResults: (searchResults) => set({ searchResults }),
  setNotifyConfig: (notifyConfig) => set({ notifyConfig }),
  setTestNotificationResult: (testNotificationResult) =>
    set({ testNotificationResult }),
}));
