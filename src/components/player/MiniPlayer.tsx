import { Play, Pause, SkipForward, Music } from 'lucide-react';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { formatDuration } from '@/utils/format';
import { useUiStore } from '@/stores/uiStore';

export function MiniPlayer() {
  const setPlayerExpanded = useUiStore((s) => s.setPlayerExpanded);
  const {
    currentTrack,
    position,
    duration,
    isPlaying,
    isLoading,
    progress,
    togglePlayPause,
    next
  } = useAudioPlayer();

  if (!currentTrack) return null;

  const handlePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    togglePlayPause();
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    next();
  };

  const handleOpenPlayer = () => {
    setPlayerExpanded(true);
  };

  return (
    <div
      onClick={handleOpenPlayer}
      className="fixed bottom-16 left-0 right-0 bg-slate-800 border-t border-slate-700 cursor-pointer z-40 touch-manipulation"
    >
      {/* Progress bar */}
      <div className="h-1 bg-slate-700">
        <div
          className="h-full bg-emerald-500 transition-all duration-200"
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="flex items-center h-16 px-4 gap-3">
        {/* Album art / icon */}
        <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center flex-shrink-0">
          <Music className="w-6 h-6 text-slate-400" />
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
