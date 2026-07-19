import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// Web Audio DSP chain settings ("sound enhancement")
export interface SoundEnhancementSettings {
  enabled: boolean;
  preset: string; // preset key or 'custom'
  eqGains: number[]; // 10 bands, dB (-12..12)
  bassBoost: number; // extra low-shelf gain, dB (0..10)
  stereoWidth: number; // extra stereo width, % (0..100)
  loudness: boolean; // compressor-based volume leveling
}

export const DEFAULT_SOUND_SETTINGS: SoundEnhancementSettings = {
  enabled: false,
  preset: 'flat',
  eqGains: Array(10).fill(0),
  bassBoost: 0,
  stereoWidth: 0,
  loudness: false
};

interface SettingsState {
  isConfigured: boolean;
  serverHost: string;
  serverPort: number;
  useHttps: boolean;
  autoCacheEnabled: boolean; // Cache streamed tracks in the background
  maxCacheSizeMB: number; // 0 = unlimited
  sound: SoundEnhancementSettings;
  downloadFormat: 'original' | 'mp3' | 'aac'; // Format for offline downloads
  downloadBitrate: number; // kbps, used when downloadFormat != original

  setConfigured: (configured: boolean) => void;
  setServerInfo: (host: string, port: number, useHttps: boolean) => void;
  setAutoCacheEnabled: (enabled: boolean) => void;
  setMaxCacheSizeMB: (sizeMB: number) => void;
  setSound: (partial: Partial<SoundEnhancementSettings>) => void;
  setDownloadFormat: (format: 'original' | 'mp3' | 'aac') => void;
  setDownloadBitrate: (bitrate: number) => void;
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
      sound: DEFAULT_SOUND_SETTINGS,
      downloadFormat: 'original',
      downloadBitrate: 192,

      setConfigured: (configured) => set({ isConfigured: configured }),
      setServerInfo: (host, port, useHttps) =>
        set({ serverHost: host, serverPort: port, useHttps, isConfigured: true }),
      setAutoCacheEnabled: (enabled) => set({ autoCacheEnabled: enabled }),
      setMaxCacheSizeMB: (sizeMB) => set({ maxCacheSizeMB: sizeMB }),
      setSound: (partial) => set((s) => ({ sound: { ...s.sound, ...partial } })),
      setDownloadFormat: (format) => set({ downloadFormat: format }),
      setDownloadBitrate: (bitrate) => set({ downloadBitrate: bitrate }),
      clearSettings: () =>
        set({ isConfigured: false, serverHost: '', serverPort: 5000, useHttps: false })
    }),
    {
      name: 'tfm-settings-storage',
      storage: createJSONStorage(() => localStorage)
    }
  )
);
