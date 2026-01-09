import {
  ChevronDown,
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  ListMusic,
  Music,
  Volume2,
  VolumeX,
  Plus,
  X
} from 'lucide-react';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { formatDuration } from '@/utils/format';
import { useState, useEffect, useRef } from 'react';
import { PlaylistPicker } from '@/components/playlists/PlaylistPicker';
import { useUiStore } from '@/stores/uiStore';

export function PlayerOverlay() {
  const setPlayerExpanded = useUiStore((s) => s.setPlayerExpanded);
  const [showQueue, setShowQueue] = useState(false);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const queueListRef = useRef<HTMLDivElement>(null);

  const {
    currentTrack,
    queue,
    currentIndex,
    position,
    duration,
    volume,
    shuffle,
    repeatMode,
    isPlaying,
    isLoading,
    togglePlayPause,
    next,
    previous,
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeatMode,
    playAtIndex
  } = useAudioPlayer();

  const handleClose = () => {
    setPlayerExpanded(false);
  };

  if (!currentTrack) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 bg-slate-900">
        <Music className="w-16 h-16 text-slate-600 mb-4" />
        <p className="text-slate-400">No track playing</p>
        <button
          onClick={handleClose}
          className="mt-4 text-emerald-400 hover:underline"
        >
          Go back
        </button>
      </div>
    );
  }

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    seek(parseFloat(e.target.value));
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  };

  const toggleMute = () => {
    setVolume(volume > 0 ? 0 : 1);
  };

  // Scroll to current song when queue is shown
  useEffect(() => {
    if (showQueue && queueListRef.current && currentIndex >= 0) {
      const currentItem = queueListRef.current.querySelector(`[data-index="${currentIndex}"]`);
      if (currentItem) {
        currentItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }, [showQueue, currentIndex]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-slate-800 to-slate-900 safe-area-top safe-area-bottom overscroll-none">
      {/* Header */}
      <header className="flex items-center justify-between p-4">
        {showQueue ? (
          // Queue header - simplified with close button
          <>
            <div className="w-10" /> {/* Spacer for balance */}
            <div className="text-center">
              <p className="text-xs text-slate-400 uppercase">Queue</p>
              <p className="text-sm text-white">{queue.length} tracks</p>
            </div>
            <button
              onClick={() => setShowQueue(false)}
              className="p-2 text-slate-400 hover:text-white transition-colors"
              title="Close queue"
            >
              <X className="w-6 h-6" />
            </button>
          </>
        ) : (
          // Player header - full controls
          <>
            <button
              onClick={handleClose}
              className="p-2 text-slate-400 hover:text-white transition-colors"
            >
              <ChevronDown className="w-6 h-6" />
            </button>
            <div className="text-center">
              <p className="text-xs text-slate-400 uppercase">Now Playing</p>
              <p className="text-sm text-white truncate max-w-[200px]">
                {currentTrack.channelName}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPlaylistPicker(true)}
                className="p-2 text-slate-400 hover:text-white transition-colors"
                title="Add to playlist"
              >
                <Plus className="w-6 h-6" />
              </button>
              <button
                onClick={() => setShowQueue(true)}
                className="p-2 text-slate-400 hover:text-white transition-colors"
              >
                <ListMusic className="w-6 h-6" />
              </button>
            </div>
          </>
        )}
      </header>

      {showQueue ? (
        // Queue View - overscroll-none prevents pull-to-refresh
        <div
          ref={queueListRef}
          className="flex-1 overflow-y-auto px-4 overscroll-none"
        >
          <div className="space-y-2 pb-4">
            {queue.map((track, index) => (
              <button
                key={`${track.fileId}-${index}`}
                data-index={index}
                onClick={() => playAtIndex(index)}
                className={`w-full flex items-center gap-3 p-3 rounded-lg transition-colors ${
                  index === currentIndex
                    ? 'bg-emerald-500/20 border border-emerald-500/50'
                    : 'bg-slate-800 hover:bg-slate-700'
                }`}
              >
                <span className="w-6 text-center text-slate-400 text-sm">
                  {index + 1}
                </span>
                <div className="w-10 h-10 bg-slate-700 rounded flex items-center justify-center flex-shrink-0">
                  <Music className="w-5 h-5 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0 text-left">
                  <p className={`text-sm truncate ${index === currentIndex ? 'text-emerald-400' : 'text-white'}`}>
                    {track.title || track.fileName}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {track.artist || track.channelName}
                  </p>
                </div>
                {index === currentIndex && isPlaying && (
                  <div className="flex gap-0.5">
                    <div className="w-1 h-4 bg-emerald-400 animate-pulse" />
                    <div className="w-1 h-4 bg-emerald-400 animate-pulse delay-75" />
                    <div className="w-1 h-4 bg-emerald-400 animate-pulse delay-150" />
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      ) : (
        // Player View
        <>
          {/* Album Art */}
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="w-full max-w-[320px] aspect-square bg-slate-700 rounded-2xl shadow-2xl flex items-center justify-center">
              <Music className="w-24 h-24 text-slate-500" />
            </div>
          </div>

          {/* Track Info */}
          <div className="px-8 text-center">
            <h1 className="text-xl font-bold text-white truncate">
              {currentTrack.title || currentTrack.fileName}
            </h1>
            <p className="text-slate-400 mt-1">
              {currentTrack.artist || 'Unknown Artist'}
            </p>
          </div>

          {/* Progress Bar */}
          <div className="px-8 mt-6">
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={position}
              onChange={handleSeek}
              className="w-full"
            />
            <div className="flex justify-between mt-2 text-xs text-slate-400 tabular-nums">
              <span>{formatDuration(position)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="px-8 py-6">
            <div className="flex items-center justify-between">
              <button
                onClick={toggleShuffle}
                className={`p-3 transition-colors ${
                  shuffle ? 'text-emerald-400' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Shuffle className="w-5 h-5" />
              </button>

              <button
                onClick={previous}
                className="p-3 text-white hover:text-emerald-400 transition-colors"
              >
                <SkipBack className="w-8 h-8" fill="currentColor" />
              </button>

              <button
                onClick={togglePlayPause}
                disabled={isLoading}
                className="w-16 h-16 bg-emerald-500 hover:bg-emerald-400 rounded-full flex items-center justify-center text-white transition-colors disabled:opacity-50"
              >
                {isLoading ? (
                  <div className="w-8 h-8 border-3 border-white border-t-transparent rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-8 h-8" fill="currentColor" />
                ) : (
                  <Play className="w-8 h-8 ml-1" fill="currentColor" />
                )}
              </button>

              <button
                onClick={next}
                className="p-3 text-white hover:text-emerald-400 transition-colors"
              >
                <SkipForward className="w-8 h-8" fill="currentColor" />
              </button>

              <button
                onClick={cycleRepeatMode}
                className={`p-3 transition-colors ${
                  repeatMode !== 'none' ? 'text-emerald-400' : 'text-slate-400 hover:text-white'
                }`}
              >
                {repeatMode === 'one' ? (
                  <Repeat1 className="w-5 h-5" />
                ) : (
                  <Repeat className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>

          {/* Volume */}
          <div className="px-8 pb-8 flex items-center gap-3">
            <button onClick={toggleMute} className="text-slate-400 hover:text-white">
              {volume === 0 ? (
                <VolumeX className="w-5 h-5" />
              ) : (
                <Volume2 className="w-5 h-5" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={handleVolumeChange}
              className="flex-1"
            />
          </div>
        </>
      )}

      {/* Playlist Picker Modal */}
      {showPlaylistPicker && currentTrack && (
        <PlaylistPicker
          track={currentTrack}
          onClose={() => setShowPlaylistPicker(false)}
        />
      )}
    </div>
  );
}
