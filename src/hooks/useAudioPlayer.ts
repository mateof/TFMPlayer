import { useCallback } from 'react';
import { audioPlayer } from '@/services/audio/AudioPlayerService';
import { usePlayerStore } from '@/stores/playerStore';
import type { Track } from '@/types/models';

export function useAudioPlayer() {
  const {
    currentTrack,
    queue,
    currentIndex,
    state,
    position,
    duration,
    volume,
    shuffle,
    repeatMode,
    error,
    bufferedRanges,
    cachedPercent
  } = usePlayerStore();

  const play = useCallback(async (track: Track, trackQueue?: Track[], startIndex?: number) => {
    await audioPlayer.play(track, trackQueue, startIndex);
  }, []);

  const playAtIndex = useCallback(async (index: number) => {
    await audioPlayer.playAtIndex(index);
  }, []);

  const pause = useCallback(() => {
    audioPlayer.pause();
  }, []);

  const resume = useCallback(() => {
    audioPlayer.resume();
  }, []);

  const togglePlayPause = useCallback(async () => {
    await audioPlayer.togglePlayPause();
  }, []);

  const next = useCallback(async () => {
    await audioPlayer.next();
  }, []);

  const previous = useCallback(async () => {
    await audioPlayer.previous();
  }, []);

  // Skip to previous track without time check (for swipe gestures)
  const skipToPrevious = useCallback(async () => {
    await audioPlayer.skipToPrevious();
  }, []);

  const seek = useCallback((position: number) => {
    audioPlayer.seek(position);
  }, []);

  const seekPercent = useCallback((percent: number) => {
    audioPlayer.seekPercent(percent);
  }, []);

  const setVolume = useCallback((vol: number) => {
    audioPlayer.setVolume(vol);
  }, []);

  const stop = useCallback(() => {
    audioPlayer.stop();
  }, []);

  const addToQueue = useCallback(async (track: Track) => {
    await audioPlayer.addToQueue(track);
  }, []);

  const addMultipleToQueue = useCallback(async (tracks: Track[]) => {
    await audioPlayer.addMultipleToQueue(tracks);
  }, []);

  // Insert track as next in queue (after current track)
  const playNext = useCallback((track: Track) => {
    usePlayerStore.getState().insertNextInQueue(track);
  }, []);

  const clearQueue = useCallback(() => {
    audioPlayer.clearQueue();
  }, []);

  const toggleShuffle = useCallback(() => {
    usePlayerStore.getState().toggleShuffle();
  }, []);

  const cycleRepeatMode = useCallback(() => {
    usePlayerStore.getState().cycleRepeatMode();
  }, []);

  // Computed values
  const isPlaying = state === 'playing';
  const isPaused = state === 'paused';
  const isLoading = state === 'loading' || state === 'buffering';
  const isStopped = state === 'stopped';
  const hasError = state === 'error';
  const progress = duration > 0 ? (position / duration) * 100 : 0;
  const hasNext = currentIndex < queue.length - 1 || repeatMode === 'all';
  const hasPrevious = currentIndex > 0 || repeatMode === 'all';

  return {
    // State
    currentTrack,
    queue,
    currentIndex,
    state,
    position,
    duration,
    volume,
    shuffle,
    repeatMode,
    error,
    bufferedRanges,
    cachedPercent,

    // Computed
    isPlaying,
    isPaused,
    isLoading,
    isStopped,
    hasError,
    progress,
    hasNext,
    hasPrevious,

    // Actions
    play,
    playAtIndex,
    pause,
    resume,
    togglePlayPause,
    next,
    previous,
    skipToPrevious,
    seek,
    seekPercent,
    setVolume,
    stop,
    addToQueue,
    addMultipleToQueue,
    playNext,
    clearQueue,
    toggleShuffle,
    cycleRepeatMode
  };
}
