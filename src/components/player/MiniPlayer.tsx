import { Play, Pause, SkipForward, Music } from 'lucide-react';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { formatDuration } from '@/utils/format';
import { getPreloadedRanges } from '@/utils/preload';
import { useUiStore } from '@/stores/uiStore';
import { useState, useEffect } from 'react';
import { cacheService } from '@/services/cache/CacheService';

export function MiniPlayer() {
  const setPlayerExpanded = useUiStore((s) => s.setPlayerExpanded);
  const [coverArt, setCoverArt] = useState<string | null>(null);
  const {
    currentTrack,
    position,
    duration,
    isPlaying,
    isLoading,
    progress,
    togglePlayPause,
    next,
    seek,
    bufferedRanges,
    cachedPercent
  } = useAudioPlayer();

  // Load cover art when track changes
  useEffect(() => {
    if (!currentTrack) {
      setCoverArt(null);
      return;
    }

    const loadCoverArt = async () => {
      const art = await cacheService.getCoverArt(currentTrack.fileId);
      setCoverArt(art || null);
    };

    loadCoverArt();
  }, [currentTrack?.fileId]);

  if (!currentTrack) return null;

  const handlePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    togglePlayPause();
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    next();
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    seek(parseFloat(e.target.value));
  };

  const handleOpenPlayer = () => {
    setPlayerExpanded(true);
  };

  return (
    <div
      onClick={handleOpenPlayer}
      className="fixed bottom-16 left-0 right-0 bg-slate-800 border-t border-slate-700 cursor-pointer z-40 touch-manipulation"
    >
      {/* Progress bar (seekable without opening the full player) */}
      <div
        className="relative h-1 bg-slate-700"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Preloaded (buffered/cached) highlight */}
        {getPreloadedRanges(bufferedRanges, cachedPercent, duration).map((range, i) => (
          <div
            key={i}
            className="absolute inset-y-0 bg-slate-500 pointer-events-none"
            style={{
              left: `${(range.start / duration) * 100}%`,
              width: `${((range.end - range.start) / duration) * 100}%`
            }}
          />
        ))}
        <div
          className="absolute inset-y-0 left-0 bg-emerald-500 transition-all duration-200 pointer-events-none"
          style={{ width: `${progress}%` }}
        />
        <input
          type="range"
          min={0}
          max={duration || 100}
          step="any"
          value={position}
          onChange={handleSeek}
          onClick={(e) => e.stopPropagation()}
          aria-label="Seek"
          className="absolute left-0 right-0 -top-2 -bottom-2 h-auto w-full opacity-0 cursor-pointer touch-manipulation"
        />
      </div>

      <div className="flex items-center h-16 px-4 gap-3">
        {/* Album art / icon */}
        <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
          {coverArt ? (
            <img src={coverArt} alt="Cover" className="w-full h-full object-cover" />
          ) : (
            <Music className="w-6 h-6 text-slate-400" />
          )}
        </div>

        {/* Track info */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-white truncate">
            {currentTrack.title || currentTrack.fileName}
          </p>
          <p className="text-xs text-slate-400 truncate">
            {currentTrack.artist || currentTrack.channelName}
          </p>
        </div>

        {/* Time */}
        <span className="text-xs text-slate-400 tabular-nums">
          {formatDuration(position)} / {formatDuration(duration)}
        </span>

        {/* Controls */}
        <div className="flex items-center gap-1">
          <button
            onClick={handlePlayPause}
            disabled={isLoading}
            className="p-2 text-white hover:text-emerald-400 transition-colors disabled:opacity-50"
          >
            {isLoading ? (
              <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-6 h-6" />
            ) : (
              <Play className="w-6 h-6" />
            )}
          </button>
          <button
            onClick={handleNext}
            className="p-2 text-slate-400 hover:text-white transition-colors"
          >
            <SkipForward className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
