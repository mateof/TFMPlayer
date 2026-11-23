import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Track, PlaybackState, RepeatMode } from '@/types/models';

export interface BufferedRange {
  start: number;
  end: number;
}

// Where the current queue came from, so more tracks can be paged in on demand.
// Captures the channel view (folder, filters, sort, search) and pagination state.
export interface QueueSource {
  type: 'channel';
  channelId: string;
  channelName: string;
  folderId?: string;
  filterMode: string;
  search?: string;
  sortBy: string;
  sortDesc: boolean;
  nextPage: number;
  pageSize: number;
  hasMore: boolean;
}

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
  bufferedRanges: BufferedRange[]; // Seconds buffered by the audio element
  cachedPercent: number; // Background auto-cache download progress (0-100)
  queueSource: QueueSource | null; // Paginated origin of the queue (null = static queue)
  savedPosition: number; // Last known position, restored with the queue on startup
  sleepTimerEndsAt: number | null; // Epoch ms when the sleep timer pauses playback
  sleepAtEndOfTrack: boolean; // Sleep timer set to "end of this track"

  // Actions
  setCurrentTrack: (track: Track | null) => void;
  setQueue: (queue: Track[]) => void;
  setCurrentIndex: (index: number) => void;
  setState: (state: PlaybackState) => void;
  setPosition: (position: number) => void;
  setDuration: (duration: number) => void;
  setBufferedRanges: (ranges: BufferedRange[]) => void;
  setCachedPercent: (percent: number) => void;
  setQueueSource: (source: QueueSource | null) => void;
  setSavedPosition: (position: number) => void;
  setSleepTimer: (endsAt: number | null, atEndOfTrack: boolean) => void;
  setVolume: (volume: number) => void;
  toggleShuffle: () => void;
  cycleRepeatMode: () => void;
  setRepeatMode: (mode: RepeatMode) => void;
  setError: (error: string | null) => void;
  setShowEqualizer: (show: boolean) => void;
  toggleEqualizer: () => void;
  addToQueue: (track: Track) => void;
  addMultipleToQueue: (tracks: Track[]) => void;
  insertNextInQueue: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  moveInQueue: (fromIndex: number, toIndex: number) => void;
  hasNext: () => boolean;
  hasPrevious: () => boolean;
}

const PERSISTED_QUEUE_MAX = 1500;

function windowQueue(queue: Track[], currentIndex: number): { queue: Track[]; currentIndex: number } {
  if (queue.length <= PERSISTED_QUEUE_MAX) return { queue, currentIndex };
  const start = Math.max(0, Math.min(currentIndex - 100, queue.length - PERSISTED_QUEUE_MAX));
  return { queue: queue.slice(start, start + PERSISTED_QUEUE_MAX), currentIndex: currentIndex - start };
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
      bufferedRanges: [],
      cachedPercent: 0,
      queueSource: null,
      savedPosition: 0,
      sleepTimerEndsAt: null,
      sleepAtEndOfTrack: false,

      setCurrentTrack: (track) => set({ currentTrack: track }),
      // Replacing the queue invalidates any previous paginated source; the new
      // source (if any) is set explicitly by the page that started playback
      setQueue: (queue) => set({ queue, queueSource: null }),
      setCurrentIndex: (index) => set({ currentIndex: index }),
      setState: (state) => set({ state, error: state === 'error' ? get().error : null }),
      setPosition: (position) => set({ position }),
      setDuration: (duration) => set({ duration }),
      setBufferedRanges: (ranges) => set({ bufferedRanges: ranges }),
      setCachedPercent: (percent) => set({ cachedPercent: percent }),
      setSavedPosition: (savedPosition) => set({ savedPosition }),
      setSleepTimer: (sleepTimerEndsAt, sleepAtEndOfTrack) => set({ sleepTimerEndsAt, sleepAtEndOfTrack }),
      setQueueSource: (source) => set({ queueSource: source }),
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
      insertNextInQueue: (track) =>
        set((s) => {
          // Insert track right after the current track
          const insertIndex = s.currentIndex + 1;
          const newQueue = [...s.queue];
          newQueue.splice(insertIndex, 0, track);
          return { queue: newQueue };
        }),
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
      clearQueue: () => set({ queue: [], currentIndex: 0, currentTrack: null, queueSource: null }),
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
      // The queue survives closing the app. Very long queues keep a window
      // around the current track so localStorage stays small.
      partialize: (state) => {
        const { queue, currentIndex } = windowQueue(state.queue, state.currentIndex);
        return {
          volume: state.volume,
          shuffle: state.shuffle,
          repeatMode: state.repeatMode,
          showEqualizer: state.showEqualizer,
          queue,
          currentIndex,
          currentTrack: state.currentTrack,
          savedPosition: state.savedPosition,
          queueSource: state.queueSource
        };
      }
    }
  )
);
