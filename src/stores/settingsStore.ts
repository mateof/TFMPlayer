import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

interface SettingsState {
  isConfigured: boolean;
  serverHost: string;
  serverPort: number;
  useHttps: boolean;
  autoCacheEnabled: boolean; // Cache streamed tracks in the background
  maxCacheSizeMB: number; // 0 = unlimited

  setConfigured: (configured: boolean) => void;
  setServerInfo: (host: string, port: number, useHttps: boolean) => void;
  setAutoCacheEnabled: (enabled: boolean) => void;
  setMaxCacheSizeMB: (sizeMB: number) => void;
  clearSettings: () => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      isConfigured: false,
      serverHost: '',
      serverPort: 5000,
      useHttps: false,
      autoCacheEnabled: true,
      maxCacheSizeMB: 2048,

      setConfigured: (configured) => set({ isConfigured: configured }),
      setServerInfo: (host, port, useHttps) =>
        set({ serverHost: host, serverPort: port, useHttps, isConfigured: true }),
      setAutoCacheEnabled: (enabled) => set({ autoCacheEnabled: enabled }),
      setMaxCacheSizeMB: (sizeMB) => set({ maxCacheSizeMB: sizeMB }),
      clearSettings: () =>
        set({ isConfigured: false, serverHost: '', serverPort: 5000, useHttps: false })
    }),
    {
      name: 'tfm-settings-storage',
      storage: createJSONStorage(() => localStorage)
    }
  )
);
