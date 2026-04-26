import { create } from "zustand";
import { persist } from "zustand/middleware";

type ThemeMode = "system" | "light" | "dark";

interface SettingsState {
  theme: ThemeMode;
  setTheme: (theme: ThemeMode) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      theme: "system",
      setTheme: (theme) => set({ theme }),
    }),
    { name: "navette-settings" },
  ),
);
