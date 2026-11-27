import { Play, Pause, SkipForward, Music } from 'lucide-react';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { formatDuration } from '@/utils/format';
import { getPreloadedRanges } from '@/utils/preload';
import { useUiStore } from '@/stores/uiStore';
import { useState, useRef } from 'react';
import { useCoverArt } from '@/hooks/useCoverArt';
import { useSeekDrag } from '@/hooks/useSeekDrag';
import { useSettingsStore } from '@/stores/settingsStore';
import { t } from '@/i18n';

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
    next,
    skipToPrevious,
    seek,
    bufferedRanges,
    cachedPercent
  } = useAudioPlayer();

  // Horizontal swipe on the mini player: left = next, right = previous
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const swipeTriggeredRef = useRef(false);
  const [swipeX, setSwipeX] = useState(0);
  const [swipeAnimating, setSwipeAnimating] = useState(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    // Leave the seek bar and its drag alone
    if ((e.target as HTMLElement).closest('input[type="range"]')) {
      touchStartRef.current = null;
      return;
    }
    touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    setSwipeAnimating(false);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const deltaX = e.touches[0].clientX - touchStartRef.current.x;
    const deltaY = e.touches[0].clientY - touchStartRef.current.y;
    if (Math.abs(deltaX) > 10 && Math.abs(deltaX) > Math.abs(deltaY)) {
      setSwipeX(Math.max(-90, Math.min(90, deltaX)));
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStartRef.current) return;
    const deltaX = e.changedTouches[0].clientX - touchStartRef.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStartRef.current.y;
    touchStartRef.current = null;
    setSwipeAnimating(true);
    setSwipeX(0);

    if (Math.abs(deltaX) > 60 && Math.abs(deltaX) > Math.abs(deltaY)) {
      swipeTriggeredRef.current = true;
      if (deltaX < 0) {
        next();
      } else {
        skipToPrevious();
      }
    }
  };

  const coverArt = useCoverArt(currentTrack?.fileId);
  const ambientBackground = useSettingsStore((s) => s.ambientBackground);
  // Seeks when the finger is lifted, not on every step of the drag
  const seekBar = useSeekDrag(position, seek);

  if (!currentTrack) return null;
  const shownProgress = duration > 0 ? (seekBar.value / duration) * 100 : progress;

  const handlePlayPause = (e: React.MouseEvent) => {
    e.stopPropagation();
    togglePlayPause();
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    next();
  };

  const handleOpenPlayer = () => {
    // A completed swipe must not also expand the player
    if (swipeTriggeredRef.current) {
      swipeTriggeredRef.current = false;
      return;
    }
    setPlayerExpanded(true);
  };

  return (
    // Floating card above the tab bar; part of the layout, never overlapped
    <div className="shrink-0 px-2 pt-1.5 pb-1 bg-slate-900">
      <div
        onClick={handleOpenPlayer}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        role="button"
        tabIndex={0}
        aria-label={t('Open full player')}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setPlayerExpanded(true);
        }}
        className="relative rounded-2xl overflow-hidden bg-slate-800 shadow-lg shadow-black/30 ring-1 ring-white/5 cursor-pointer touch-manipulation"
      >
        {/* Ambient tint from the cover */}
        {ambientBackground && coverArt && (
          <img src={coverArt} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-150 blur-2xl opacity-40 pointer-events-none" />
        )}

        <div
          className="relative flex items-center h-16 pl-2 pr-1 gap-3"
          style={{
            transform: swipeX !== 0 ? `translateX(${swipeX}px)` : undefined,
            opacity: swipeX !== 0 ? 1 - Math.abs(swipeX) / 250 : 1,
            transition: swipeAnimating ? 'transform 0.2s ease-out, opacity 0.2s ease-out' : 'none'
          }}
        >
          <div className="w-12 h-12 bg-slate-700 rounded-xl flex items-center justify-center shrink-0 overflow-hidden shadow">
            {coverArt ? (
              <img src={coverArt} alt={t('Cover')} className="w-full h-full object-cover" />
            ) : (
              <Music className="w-6 h-6 text-slate-400" aria-hidden />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-white truncate">
              {currentTrack.title || currentTrack.fileName}
            </p>
            <p className="text-xs text-slate-300/80 truncate">
              {currentTrack.artist || currentTrack.channelName}
              <span className="hidden min-[400px]:inline tabular-nums text-slate-400">
                {' · '}{formatDuration(seekBar.value)} / {formatDuration(duration)}
              </span>
            </p>
          </div>

          <button
            onClick={handlePlayPause}
            disabled={isLoading}
            aria-label={isPlaying ? t('Pause') : t('Play')}
            className="w-11 h-11 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0 active:scale-95 transition-transform disabled:opacity-60"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-5 h-5" fill="currentColor" aria-hidden />
            ) : (
              <Play className="w-5 h-5 ml-0.5" fill="currentColor" aria-hidden />
            )}
          </button>
          <button
            onClick={handleNext}
            aria-label={t('Next track')}
            className="p-2.5 text-slate-300 hover:text-white transition-colors shrink-0"
          >
            <SkipForward className="w-5 h-5" fill="currentColor" aria-hidden />
          </button>
        </div>

        {/* Progress (seekable without opening the full player) */}
        <div className="relative h-1 bg-white/10" onClick={(e) => e.stopPropagation()}>
          {getPreloadedRanges(bufferedRanges, cachedPercent, duration).map((range, i) => (
            <div
              key={i}
              className="absolute inset-y-0 bg-white/20 pointer-events-none"
              style={{
                left: `${(range.start / duration) * 100}%`,
                width: `${((range.end - range.start) / duration) * 100}%`
              }}
            />
          ))}
          <div
            className="absolute inset-y-0 left-0 bg-emerald-400 transition-[width] duration-200 pointer-events-none"
            style={{ width: `${shownProgress}%` }}
          />
          <input
            type="range"
            min={0}
            max={duration || 100}
            step="any"
            {...seekBar.inputProps}
            onClick={(e) => e.stopPropagation()}
            aria-label={t('Seek')}
            className="absolute left-0 right-0 -top-3 -bottom-1 h-auto w-full opacity-0 cursor-pointer touch-manipulation"
          />
        </div>
      </div>
    </div>
  );
}
