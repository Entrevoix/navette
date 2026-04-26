import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ConnectionStatus, SavedConfig, ServerConfig } from "../types";
import { createNavetteWS, type NavetteWS } from "../lib/ws";

interface ConnectionState {
  status: ConnectionStatus | "reconnecting";
  reconnectCount: number;
  savedConfigs: SavedConfig[];
  currentConfig: ServerConfig | null;
  ws: NavetteWS;

  connect: (config: ServerConfig) => void;
  disconnect: () => void;
  saveConfig: (config: SavedConfig) => void;
  deleteConfig: (id: string) => void;
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => {
      const ws = createNavetteWS();
      let reconnectCount = 0;

      ws.onStatusChange((status) => {
        if (status === "reconnecting") {
          reconnectCount++;
        } else if (status === "connected") {
          reconnectCount = 0;
        }
        set({
          status: status as ConnectionStatus | "reconnecting",
          reconnectCount,
        });
      });

      return {
        status: "disconnected",
        reconnectCount: 0,
        savedConfigs: [],
        currentConfig: null,
        ws,

        connect(config: ServerConfig) {
          set({ currentConfig: config });
          ws.connect(config);
        },

        disconnect() {
          ws.disconnect();
          set({ currentConfig: null });
        },

        saveConfig(config: SavedConfig) {
          const configs = get().savedConfigs;
          const idx = configs.findIndex((c) => c.id === config.id);
          if (idx >= 0) {
            const updated = [...configs];
            updated[idx] = config;
            set({ savedConfigs: updated });
          } else {
            set({ savedConfigs: [...configs, config] });
          }
        },

        deleteConfig(id: string) {
          set({
            savedConfigs: get().savedConfigs.filter((c) => c.id !== id),
          });
        },
      };
    },
    {
      name: "navette-connection",
      partialize: (state) => ({
        savedConfigs: state.savedConfigs,
      }),
    },
  ),
);
