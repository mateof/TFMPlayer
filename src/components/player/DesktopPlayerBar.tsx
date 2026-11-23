import { useState } from 'react';
import {
  Play, Pause, SkipForward, SkipBack, Shuffle, Repeat, Repeat1, Music,
  Volume2, VolumeX, Maximize2, PanelRight
} from 'lucide-react';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useUiStore } from '@/stores/uiStore';
import { useCoverArt } from '@/hooks/useCoverArt';
import { formatDuration } from '@/utils/format';
import { getPreloadedRanges } from '@/utils/preload';

/**
 * Full-width player bar for desktop: track info, transport controls with a
 * wide seek bar, and volume. Replaces the mini player from the lg breakpoint.
 */
export function DesktopPlayerBar() {
  const setPlayerExpanded = useUiStore((s) => s.setPlayerExpanded);
  const isPanelOpen = useUiStore((s) => s.isNowPlayingPanelOpen);
  const togglePanel = useUiStore((s) => s.toggleNowPlayingPanel);
  const [lastVolume, setLastVolume] = useState(1);

  const {
    currentTrack, position, duration, volume, shuffle, repeatMode,
    isPlaying, isLoading, progress, bufferedRanges, cachedPercent,
    togglePlayPause, next, previous, seek, setVolume, toggleShuffle, cycleRepeatMode
  } = useAudioPlayer();

  const coverArt = useCoverArt(currentTrack?.fileId);

  if (!currentTrack) return null;

  const toggleMute = () => {
    if (volume > 0) {
      setLastVolume(volume);
      setVolume(0);
    } else {
      setVolume(lastVolume || 1);
    }
  };

  const iconButton = 'p-2 rounded-full transition-colors disabled:opacity-50';

  return (
    <div className="h-20 px-4 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)] items-center gap-6 bg-slate-950 border-t border-slate-800">
      {/* Track */}
      <button
        onClick={() => setPlayerExpanded(true)}
        className="flex items-center gap-3 min-w-0 text-left group"
        title="Open full player"
      >
        <div className="w-14 h-14 bg-slate-800 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
          {coverArt ? (
            <img src={coverArt} alt="" className="w-full h-full object-cover" />
          ) : (
            <Music className="w-6 h-6 text-slate-500" />
          )}
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate group-hover:underline">
            {currentTrack.title || currentTrack.fileName}
          </p>
          <p className="text-xs text-slate-400 truncate">
            {[currentTrack.artist, currentTrack.album].filter(Boolean).join(' · ') || currentTrack.channelName}
          </p>
        </div>
      </button>

      {/* Transport + seek */}
      <div className="flex flex-col items-center gap-1 min-w-0">
        <div className="flex items-center gap-2">
          <button
            onClick={toggleShuffle}
            className={`${iconButton} ${shuffle ? 'text-emerald-400' : 'text-slate-400 hover:text-white'}`}
            title="Shuffle"
          >
            <Shuffle className="w-4 h-4" />
          </button>
          <button onClick={previous} className={`${iconButton} text-slate-300 hover:text-white`} title="Previous (Shift+←)">
            <SkipBack className="w-5 h-5" fill="currentColor" />
          </button>
          <button
            onClick={togglePlayPause}
            disabled={isLoading}
            className="w-10 h-10 rounded-full bg-white text-slate-900 flex items-center justify-center hover:scale-105 transition-transform disabled:opacity-60"
            title="Play/Pause (Space)"
          >
            {isLoading ? (
              <div className="w-5 h-5 border-2 border-slate-900 border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-5 h-5" fill="currentColor" />
            ) : (
              <Play className="w-5 h-5 ml-0.5" fill="currentColor" />
            )}
          </button>
          <button onClick={next} className={`${iconButton} text-slate-300 hover:text-white`} title="Next (Shift+→)">
            <SkipForward className="w-5 h-5" fill="currentColor" />
          </button>
          <button
            onClick={cycleRepeatMode}
            className={`${iconButton} ${repeatMode !== 'none' ? 'text-emerald-400' : 'text-slate-400 hover:text-white'}`}
            title={`Repeat: ${repeatMode}`}
          >
            {repeatMode === 'one' ? <Repeat1 className="w-4 h-4" /> : <Repeat className="w-4 h-4" />}
          </button>
        </div>

        <div className="w-full flex items-center gap-3">
          <span className="text-xs text-slate-400 tabular-nums w-10 text-right">{formatDuration(position)}</span>
          <div className="relative flex-1 h-1 rounded-full bg-slate-700 group">
            {getPreloadedRanges(bufferedRanges, cachedPercent, duration).map((range, i) => (
              <div
                key={i}
                className="absolute inset-y-0 bg-slate-500 rounded-full pointer-events-none"
                style={{
                  left: `${(range.start / duration) * 100}%`,
                  width: `${((range.end - range.start) / duration) * 100}%`
                }}
              />
            ))}
            <div
              className="absolute inset-y-0 left-0 bg-emerald-500 rounded-full pointer-events-none"
              style={{ width: `${progress}%` }}
            />
            <input
              type="range"
              min={0}
              max={duration || 100}
              step="any"
              value={position}
              onChange={(e) => seek(parseFloat(e.target.value))}
              aria-label="Seek"
              className="absolute left-0 right-0 -top-2 -bottom-2 h-auto w-full opacity-0 cursor-pointer"
            />
          </div>
          <span className="text-xs text-slate-400 tabular-nums w-10">{formatDuration(duration)}</span>
        </div>
      </div>

      {/* Volume + panels */}
      <div className="flex items-center justify-end gap-2">
        <button onClick={toggleMute} className={`${iconButton} text-slate-400 hover:text-white`} title="Mute">
          {volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          aria-label="Volume"
          className="w-28"
        />
        <button
          onClick={togglePanel}
          className={`hidden xl:block ${iconButton} ${isPanelOpen ? 'text-emerald-400' : 'text-slate-400 hover:text-white'}`}
          title="Now playing panel"
        >
          <PanelRight className="w-5 h-5" />
        </button>
        <button
          onClick={() => setPlayerExpanded(true)}
          className={`${iconButton} text-slate-400 hover:text-white`}
          title="Full player (equalizer, queue)"
        >
          <Maximize2 className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
}
