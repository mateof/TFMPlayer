import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Track, PlaybackState, RepeatMode } from '@/types/models';

interface PlayerState {
  currentTrack: Track | null;
  queue: Track[];
  currentIndex: number;
  state: PlaybackState;
  position: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
  error: string | null;
  showEqualizer: boolean;

  // Actions
  setCurrentTrack: (track: Track | null) => void;
  setQueue: (queue: Track[]) => void;
  setCurrentIndex: (index: number) => void;
  setState: (state: PlaybackState) => void;
  setPosition: (position: number) => void;
  setDuration: (duration: number) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  setRepeatMode: (mode: RepeatMode) => void;
  setError: (error: string | null) => void;
  setShowEqualizer: (show: boolean) => void;
  toggleEqualizer: () => void;
  addToQueue: (track: Track) => void;
  addMultipleToQueue: (tracks: Track[]) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  moveInQueue: (fromIndex: number, toIndex: number) => void;
  hasNext: () => boolean;
  hasPrevious: () => boolean;
}

export const usePlayerStore = create<PlayerState>()(
  persist(
    (set, get) => ({
      currentTrack: null,
      queue: [],
      currentIndex: 0,
      state: 'stopped',
      position: 0,
      duration: 0,
      volume: 1,
      shuffle: false,
      repeatMode: 'none',
      error: null,
      showEqualizer: false,

      setCurrentTrack: (track) => set({ currentTrack: track }),
      setQueue: (queue) => set({ queue }),
      setCurrentIndex: (index) => set({ currentIndex: index }),
      setState: (state) => set({ state, error: state === 'error' ? get().error : null }),
      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      setVolume: (volume) => set({ volume }),
      toggleShuffle: () => set((s) => ({ shuffle: !s.shuffle })),
      cycleRepeatMode: () =>
        set((s) => ({
          repeatMode:
            s.repeatMode === 'none' ? 'all' : s.repeatMode === 'all' ? 'one' : 'none'
        })),
      setRepeatMode: (mode) => set({ repeatMode: mode }),
      setError: (error) => set({ error }),
      setShowEqualizer: (show) => set({ showEqualizer: show }),
      toggleEqualizer: () => set((s) => ({ showEqualizer: !s.showEqualizer })),
      addToQueue: (track) => set((s) => ({ queue: [...s.queue, track] })),
      addMultipleToQueue: (tracks) => set((s) => ({ queue: [...s.queue, ...tracks] })),
      removeFromQueue: (index) =>
        set((s) => {
          const newQueue = s.queue.filter((_, i) => i !== index);
          let newIndex = s.currentIndex;
          if (index < s.currentIndex) {
            newIndex = s.currentIndex - 1;
          } else if (index === s.currentIndex && index >= newQueue.length) {
            newIndex = Math.max(0, newQueue.length - 1);
          }
          return { queue: newQueue, currentIndex: newIndex };
        }),
      clearQueue: () => set({ queue: [], currentIndex: 0, currentTrack: null }),
      moveInQueue: (fromIndex, toIndex) =>
        set((s) => {
          const newQueue = [...s.queue];
          const [removed] = newQueue.splice(fromIndex, 1);
          newQueue.splice(toIndex, 0, removed);
          let newIndex = s.currentIndex;
          if (fromIndex === s.currentIndex) {
            newIndex = toIndex;
          } else if (fromIndex < s.currentIndex && toIndex >= s.currentIndex) {
            newIndex = s.currentIndex - 1;
          } else if (fromIndex > s.currentIndex && toIndex <= s.currentIndex) {
            newIndex = s.currentIndex + 1;
          }
          return { queue: newQueue, currentIndex: newIndex };
        }),
      hasNext: () => {
        const { queue, currentIndex, repeatMode } = get();
        return currentIndex < queue.length - 1 || repeatMode === 'all';
      },
      hasPrevious: () => {
        const { currentIndex, repeatMode, queue } = get();
        return currentIndex > 0 || repeatMode === 'all' && queue.length > 0;
      }
    }),
    {
      name: 'tfm-player-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        volume: state.volume,
        shuffle: state.shuffle,
        repeatMode: state.repeatMode,
        showEqualizer: state.showEqualizer
      })
    }
  )
);
