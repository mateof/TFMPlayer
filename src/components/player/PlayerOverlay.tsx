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
  X,
  Loader2,
  Activity,
  RotateCcw,
  RotateCw,
  Info,
  AudioLines,
  Minimize2
} from 'lucide-react';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { formatDuration, formatFileSize } from '@/utils/format';
import { getPreloadedRanges } from '@/utils/preload';
import { useState, useEffect, useRef, useMemo } from 'react';
import { PlaylistPicker } from '@/components/playlists/PlaylistPicker';
import { useUiStore } from '@/stores/uiStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { audioMetadataService, type AudioMetadata } from '@/services/audio/AudioMetadataService';
import { audioPlayer } from '@/services/audio/AudioPlayerService';
import { cacheService } from '@/services/cache/CacheService';
import { AudioEqualizer } from './AudioEqualizer';
import { QueueList } from './QueueList';
import { SleepTimerButton } from './SleepTimerButton';
import { useMediaQuery, DESKTOP_QUERY } from '@/hooks/useMediaQuery';
import { useCoverArt } from '@/hooks/useCoverArt';
import { t } from '@/i18n';

// Swipe gesture hook
function useSwipeGesture({
  onSwipeLeft,
  onSwipeRight,
  onSwipeDown,
  threshold = 50,
  verticalThreshold = 100
}: {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeDown?: () => void;
  threshold?: number;
  verticalThreshold?: number;
}) {
  const [touchStart, setTouchStart] = useState<{ x: number; y: number } | null>(null);
  const [touchDelta, setTouchDelta] = useState({ x: 0, y: 0 });
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeDirection, setSwipeDirection] = useState<'horizontal' | 'vertical' | null>(null);

  const handlers = useMemo(() => ({
    onTouchStart: (e: React.TouchEvent) => {
      const touch = e.touches[0];
      setTouchStart({ x: touch.clientX, y: touch.clientY });
      setTouchDelta({ x: 0, y: 0 });
      setIsSwiping(true);
      setSwipeDirection(null);
    },
    onTouchMove: (e: React.TouchEvent) => {
      if (!touchStart) return;
      const touch = e.touches[0];
      const deltaX = touch.clientX - touchStart.x;
      const deltaY = touch.clientY - touchStart.y;

      // Determine swipe direction on first significant movement
      if (!swipeDirection && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
        setSwipeDirection(Math.abs(deltaX) > Math.abs(deltaY) ? 'horizontal' : 'vertical');
      }

      // Only track movement in the determined direction
      if (swipeDirection === 'horizontal') {
        setTouchDelta({ x: deltaX, y: 0 });
      } else if (swipeDirection === 'vertical' && deltaY > 0) {
        // Only allow downward swipe
        setTouchDelta({ x: 0, y: deltaY });
      }
    },
    onTouchEnd: () => {
      if (swipeDirection === 'horizontal') {
        if (touchDelta.x < -threshold && onSwipeLeft) {
          onSwipeLeft();
        } else if (touchDelta.x > threshold && onSwipeRight) {
          onSwipeRight();
        }
      } else if (swipeDirection === 'vertical') {
        if (touchDelta.y > verticalThreshold && onSwipeDown) {
          onSwipeDown();
        }
      }

      setTouchStart(null);
      setTouchDelta({ x: 0, y: 0 });
      setIsSwiping(false);
      setSwipeDirection(null);
    }
  }), [touchStart, touchDelta, swipeDirection, threshold, verticalThreshold, onSwipeLeft, onSwipeRight, onSwipeDown]);

  return { handlers, touchDelta, isSwiping, swipeDirection };
}

export function PlayerOverlay() {
  const setPlayerExpanded = useUiStore((s) => s.setPlayerExpanded);
  const showEqualizer = usePlayerStore((s) => s.showEqualizer);
  const toggleEqualizer = usePlayerStore((s) => s.toggleEqualizer);
  const skipButtonsEnabled = useSettingsStore((s) => s.skipButtonsEnabled);
  const skipBackSeconds = useSettingsStore((s) => s.skipBackSeconds);
  const skipForwardSeconds = useSettingsStore((s) => s.skipForwardSeconds);
  const [showQueue, setShowQueue] = useState(false);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  // Start flipped to the equalizer when the user left it open last time
  const [isFlipped, setIsFlipped] = useState(() => usePlayerStore.getState().showEqualizer);
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [coverArts, setCoverArts] = useState<Record<string, string>>({});
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [desktopTab, setDesktopTab] = useState<'queue' | 'details' | 'visualizer'>('queue');

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
    bufferedRanges,
    cachedPercent,
    togglePlayPause,
    next,
    previous,
    skipToPrevious,
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeatMode
  } = useAudioPlayer();

  const handleClose = () => {
    setPlayerExpanded(false);
  };

  // Cover stored with the download, shown until the tags are parsed
  const storedCover = useCoverArt(currentTrack?.fileId);
  const ambientBackground = useSettingsStore((s) => s.ambientBackground);

  // Disable the browser's pull-to-refresh while the player is expanded.
  // Chrome decides PTR at gesture start, before our touchmove preventDefault
  // can run, so the drag-to-dismiss below can lose that race on the first
  // gesture. overscroll-behavior on the root scroller removes PTR entirely
  // without affecting inner scrolling (queue, metadata).
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overscrollBehaviorY;
    const prevBody = body.style.overscrollBehaviorY;
    html.style.overscrollBehaviorY = 'none';
    body.style.overscrollBehaviorY = 'none';
    return () => {
      html.style.overscrollBehaviorY = prevHtml;
      body.style.overscrollBehaviorY = prevBody;
    };
  }, []);

  // Drag-down anywhere on the overlay to collapse it. Native non-passive
  // listeners so preventDefault() can block the browser's pull-to-refresh
  // (React's synthetic touch events can't). Scrollable areas and sliders
  // are exempt via [data-no-dismiss] / input[type=range].
  const overlayRef = useRef<HTMLDivElement>(null);
  const [dismissDragY, setDismissDragY] = useState(0);
  const [dismissDragging, setDismissDragging] = useState(false);

  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    let startX = 0;
    let startY = 0;
    let currentY = 0;
    let mode: 'none' | 'pending' | 'drag' = 'none';

    const isExempt = (target: EventTarget | null) =>
      !!(target as HTMLElement | null)?.closest('input[type="range"], [data-no-dismiss]');

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || isExempt(e.target)) {
        mode = 'none';
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      currentY = 0;
      mode = 'pending';
    };

    const onTouchMove = (e: TouchEvent) => {
      if (mode === 'none') return;
      const deltaX = e.touches[0].clientX - startX;
      const deltaY = e.touches[0].clientY - startY;

      if (mode === 'pending') {
        if (Math.abs(deltaX) < 12 && Math.abs(deltaY) < 12) return;
        // Only capture clearly-downward drags; leave horizontal swipes
        // (next/previous on the album art) untouched
        if (deltaY > 0 && deltaY > Math.abs(deltaX) * 1.2) {
          mode = 'drag';
          setDismissDragging(true);
        } else {
          mode = 'none';
          return;
        }
      }

      // Dragging the sheet: stop pull-to-refresh and follow the finger
      e.preventDefault();
      currentY = Math.max(0, deltaY);
      setDismissDragY(currentY);
    };

    const finish = () => {
      if (mode === 'drag') {
        setDismissDragging(false);
        if (currentY > 120) {
          setPlayerExpanded(false);
        } else {
          setDismissDragY(0);
        }
      }
      mode = 'none';
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', finish);
    el.addEventListener('touchcancel', finish);
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', finish);
      el.removeEventListener('touchcancel', finish);
    };
  }, [setPlayerExpanded, currentTrack]);


  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    seek(parseFloat(e.target.value));
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setVolume(parseFloat(e.target.value));
  };

  const toggleMute = () => {
    setVolume(volume > 0 ? 0 : 1);
  };

  // Load metadata when track changes (keyed on the id: the track object is
  // replaced when its tags are filled in, which must not restart the load)
  const currentFileId = currentTrack?.fileId;
  useEffect(() => {
    const currentTrack = usePlayerStore.getState().currentTrack;
    if (!currentFileId || !currentTrack) {
      setMetadata(null);
      audioPlayer.updateCoverArt(null);
      return;
    }

    // Reset metadata (but keep flip state if equalizer is on)
    setMetadata(null);
    let cancelled = false;

    const loadMetadata = async () => {
      setLoadingMetadata(true);
      try {
        const meta = await audioMetadataService.getMetadata(
          currentTrack.fileId,
          currentTrack.streamUrl,
          currentTrack.fileSize
        );
        if (cancelled) return;
        setMetadata(meta);

        // Update MediaSession cover art if available
        if (meta?.coverArt) {
          audioPlayer.updateCoverArt(meta.coverArt);
        }
      } catch (error) {
        console.error('Failed to load metadata:', error);
      } finally {
        if (!cancelled) setLoadingMetadata(false);
      }
    };

    // Delay loading slightly to let playback start first
    const timeout = setTimeout(loadMetadata, 500);

    // With the screen off the service only returns stored fields (no file
    // parsing in background): run the full extraction once visible again
    const onVisible = () => {
      if (!document.hidden) loadMetadata();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [currentFileId]);

  // Load cover arts for queue tracks: one bulk read for the ones not seen yet
  const coverArtsRequestedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const missing = queue
      .map((track) => track.fileId)
      .filter((id) => !coverArtsRequestedRef.current.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => coverArtsRequestedRef.current.add(id));

    // Not cancelled on re-run: the ids are already marked as requested, so
    // dropping this answer would leave them without art for good
    cacheService.getCoverArts(missing).then((found) => {
      if (Object.keys(found).length > 0) {
        setCoverArts((prev) => ({ ...prev, ...found }));
      }
    }).catch(() => {});
  }, [queue]);

  const handleFlip = () => {
    setIsFlipped(!isFlipped);
  };

  // Swipe gestures for album art card (horizontal only: next/previous).
  // Downward drags are handled by the overlay-wide dismiss gesture.
  const { handlers: cardSwipeHandlers, touchDelta, isSwiping, swipeDirection } = useSwipeGesture({
    onSwipeLeft: () => {
      if (queue.length > 1) next();
    },
    onSwipeRight: () => {
      // Use skipToPrevious to always go to previous track (not restart current)
      if (queue.length > 1) skipToPrevious();
    },
    threshold: 80
  });

  // Early exit only after every hook has run: returning before them changed
  // the hook order between renders (rules-of-hooks) and could crash the
  // overlay when the last track was cleared while it was open.
  if (!currentTrack) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center p-6 bg-slate-900">
        <Music className="w-16 h-16 text-slate-600 mb-4" />
        <p className="text-slate-400">{t('No track playing')}</p>
        <button
          onClick={handleClose}
          className="mt-4 text-emerald-400 hover:underline"
        >
          {t('Go back')}
        </button>
      </div>
    );
  }

  // Calculate card transform based on swipe
  const getCardTransform = () => {
    if (!isSwiping) return {};

    if (swipeDirection === 'horizontal') {
      const rotation = touchDelta.x * 0.1; // Subtle rotation
      const opacity = 1 - Math.abs(touchDelta.x) / 300;
      return {
        transform: `translateX(${touchDelta.x}px) rotate(${rotation}deg)`,
        opacity: Math.max(0.5, opacity)
      };
    }
    // Vertical drags are handled by the overlay-wide dismiss gesture
    return {};
  };

  if (isDesktop) {
    const cover = metadata?.coverArt ?? storedCover;
    const techChips = [
      metadata?.format?.toUpperCase(),
      metadata?.bitrate ? `${metadata.bitrate} kbps` : null,
      metadata?.sampleRate ? `${(metadata.sampleRate / 1000).toFixed(1)} kHz` : null,
      metadata?.bitsPerSample ? `${metadata.bitsPerSample} bit` : null
    ].filter(Boolean) as string[];
    const repeatLabel = repeatMode === 'one' ? t('This track') : repeatMode === 'all' ? t('All tracks') : t('Off');
    const tabs: { key: typeof desktopTab; label: string; icon: React.ReactNode }[] = [
      { key: 'queue', label: t('Up next'), icon: <ListMusic className="w-4 h-4" aria-hidden /> },
      { key: 'details', label: t('Details'), icon: <Info className="w-4 h-4" aria-hidden /> },
      { key: 'visualizer', label: t('Visualizer'), icon: <AudioLines className="w-4 h-4" aria-hidden /> }
    ];

    return (
      <div
        className="fixed inset-0 z-50 flex flex-col bg-slate-950 text-white overflow-hidden animate-in fade-in duration-200"
        role="dialog"
        aria-modal="true"
        aria-label={t('Now playing')}
      >
        {/* Ambient background from the cover */}
        {ambientBackground && cover && (
          <img src={cover} alt="" aria-hidden className="absolute inset-0 w-full h-full object-cover scale-125 blur-3xl opacity-35 pointer-events-none" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-slate-950/30 via-slate-950/70 to-slate-950 pointer-events-none" aria-hidden />

        <header className="relative flex items-center gap-3 px-8 h-16 shrink-0">
          <button
            onClick={handleClose}
            className="p-2 rounded-full text-slate-300 hover:text-white hover:bg-white/10"
            aria-label={t('Minimize player (Esc)')}
            title={t('Minimize player (Esc)')}
          >
            <Minimize2 className="w-5 h-5" aria-hidden />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-[0.2em] text-slate-400">{t('Now playing')}</p>
            <p className="text-sm text-slate-200 truncate">
              {currentTrack.isLocalFile ? t('Local files') : currentTrack.channelName}
              {queue.length > 1 && <span className="text-slate-500"> · {t('{n} of {total}', { n: currentIndex + 1, total: queue.length })}</span>}
            </p>
          </div>
          <SleepTimerButton size="lg" />
          <button
            onClick={() => setShowPlaylistPicker(true)}
            className="p-2 rounded-full text-slate-300 hover:text-white hover:bg-white/10"
            aria-label={t('Add to playlist')}
            title={t('Add to playlist')}
          >
            <Plus className="w-5 h-5" aria-hidden />
          </button>
        </header>

        <div className="relative flex-1 min-h-0 grid grid-cols-[minmax(0,1fr)_minmax(22rem,0.75fr)] 2xl:grid-cols-[minmax(0,1fr)_minmax(26rem,0.7fr)] gap-10 px-10 pb-8">
          {/* Left: artwork and controls */}
          <section className="min-h-0 flex flex-col items-center justify-center gap-6" aria-label={t('Player')}>
            <div className="w-full max-w-[min(50vh,32rem)] aspect-square rounded-3xl overflow-hidden shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] bg-slate-800/80 flex items-center justify-center ring-1 ring-white/10">
              {cover ? (
                <img src={cover} alt={t('Cover')} className="w-full h-full object-cover" />
              ) : (
                <Music className="w-28 h-28 text-slate-600" aria-hidden />
              )}
            </div>

            <div className="w-full max-w-2xl text-center">
              <h1 className="text-3xl 2xl:text-4xl font-bold tracking-tight truncate" title={currentTrack.fileName}>
                {metadata?.title || currentTrack.title || currentTrack.fileName}
              </h1>
              <p className="mt-2 text-lg text-slate-300 truncate">
                {[metadata?.artist || currentTrack.artist, metadata?.album || currentTrack.album].filter(Boolean).join(' · ') || t('Unknown artist')}
              </p>
              {techChips.length > 0 && (
                <div className="mt-3 flex flex-wrap justify-center gap-2">
                  {techChips.map((chip) => (
                    <span key={chip} className="px-2 py-0.5 rounded-md bg-white/10 text-xs text-slate-300 tabular-nums">{chip}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="w-full max-w-2xl">
              <div className="relative flex items-center">
                <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-white/15 overflow-hidden pointer-events-none">
                  {getPreloadedRanges(bufferedRanges, cachedPercent, duration).map((range, i) => (
                    <div
                      key={i}
                      className="absolute inset-y-0 bg-white/25"
                      style={{ left: `${(range.start / duration) * 100}%`, width: `${((range.end - range.start) / duration) * 100}%` }}
                    />
                  ))}
                  <div className="absolute inset-y-0 left-0 bg-emerald-400" style={{ width: `${duration > 0 ? (position / duration) * 100 : 0}%` }} />
                </div>
                <input
                  type="range"
                  min={0}
                  max={duration || 100}
                  step="any"
                  value={position}
                  onChange={handleSeek}
                  aria-label={t('Seek')}
                  className="w-full relative track-transparent"
                />
              </div>
              <div className="flex justify-between mt-1.5 text-xs text-slate-400 tabular-nums">
                <span>{formatDuration(position)}</span>
                <span>-{formatDuration(Math.max(0, duration - position))}</span>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <button
                onClick={toggleShuffle}
                aria-pressed={shuffle}
                aria-label={t('Shuffle')}
                title={t('Shuffle')}
                className={`p-3 rounded-full transition-colors ${shuffle ? 'text-emerald-400' : 'text-slate-400 hover:text-white'}`}
              >
                <Shuffle className="w-5 h-5" aria-hidden />
              </button>
              {skipButtonsEnabled && (
                <button
                  onClick={() => seek(Math.max(0, position - skipBackSeconds))}
                  className="p-3 rounded-full text-slate-300 hover:text-white"
                  aria-label={t('Back {count} seconds', { count: skipBackSeconds })}
                >
                  <RotateCcw className="w-6 h-6" aria-hidden />
                </button>
              )}
              <button onClick={previous} className="p-3 rounded-full text-white hover:bg-white/10" aria-label={t('Previous track')} title={t('Previous (Shift+←)')}>
                <SkipBack className="w-8 h-8" fill="currentColor" aria-hidden />
              </button>
              <button
                onClick={togglePlayPause}
                disabled={isLoading}
                aria-label={isPlaying ? t('Pause') : t('Play')}
                title={t('Play/Pause (Space)')}
                className="w-20 h-20 rounded-full bg-white text-slate-900 flex items-center justify-center shadow-xl hover:scale-105 active:scale-95 transition-transform disabled:opacity-60"
              >
                {isLoading ? (
                  <div className="w-8 h-8 border-[3px] border-slate-900 border-t-transparent rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-9 h-9" fill="currentColor" aria-hidden />
                ) : (
                  <Play className="w-9 h-9 ml-1" fill="currentColor" aria-hidden />
                )}
              </button>
              <button onClick={() => next()} className="p-3 rounded-full text-white hover:bg-white/10" aria-label={t('Next track')} title={t('Next (Shift+→)')}>
                <SkipForward className="w-8 h-8" fill="currentColor" aria-hidden />
              </button>
              {skipButtonsEnabled && (
                <button
                  onClick={() => seek(position + skipForwardSeconds)}
                  className="p-3 rounded-full text-slate-300 hover:text-white"
                  aria-label={t('Forward {count} seconds', { count: skipForwardSeconds })}
                >
                  <RotateCw className="w-6 h-6" aria-hidden />
                </button>
              )}
              <button
                onClick={cycleRepeatMode}
                aria-label={t('Repeat: {mode}', { mode: repeatLabel })}
                title={t('Repeat: {mode}', { mode: repeatLabel })}
                className={`p-3 rounded-full transition-colors ${repeatMode !== 'none' ? 'text-emerald-400' : 'text-slate-400 hover:text-white'}`}
              >
                {repeatMode === 'one' ? <Repeat1 className="w-5 h-5" aria-hidden /> : <Repeat className="w-5 h-5" aria-hidden />}
              </button>
            </div>

            <div className="w-full max-w-xs flex items-center gap-3">
              <button onClick={toggleMute} className="text-slate-400 hover:text-white" aria-label={volume === 0 ? t('Unmute') : t('Mute')}>
                {volume === 0 ? <VolumeX className="w-5 h-5" aria-hidden /> : <Volume2 className="w-5 h-5" aria-hidden />}
              </button>
              <input type="range" min={0} max={1} step={0.01} value={volume} onChange={handleVolumeChange} aria-label={t('Volume')} className="flex-1" />
            </div>
          </section>

          {/* Right: queue / details / visualizer */}
          <section className="min-h-0 flex flex-col rounded-3xl bg-white/[0.06] backdrop-blur-xl ring-1 ring-white/10 overflow-hidden">
            <div role="tablist" aria-label={t('Player panels')} className="flex gap-1 p-2 border-b border-white/10">
              {tabs.map((tab) => (
                <button
                  key={tab.key}
                  role="tab"
                  aria-selected={desktopTab === tab.key}
                  onClick={() => setDesktopTab(tab.key)}
                  className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-sm transition-colors ${
                    desktopTab === tab.key ? 'bg-white/15 text-white' : 'text-slate-400 hover:text-white hover:bg-white/5'
                  }`}
                >
                  {tab.icon}
                  {tab.label}
                  {tab.key === 'queue' && <span className="text-xs text-slate-500 tabular-nums">{queue.length}</span>}
                </button>
              ))}
            </div>
            <div role="tabpanel" className="flex-1 min-h-0 flex flex-col">
              {desktopTab === 'queue' && (
                <div className="flex-1 min-h-0 flex flex-col p-2">
                  <QueueList coverArts={coverArts} active={desktopTab === 'queue'} />
                </div>
              )}
              {desktopTab === 'details' && (
                <div className="flex-1 min-h-0 overflow-y-auto p-6">
                  <TrackDetails metadata={metadata} loading={loadingMetadata} fileName={currentTrack.fileName} />
                </div>
              )}
              {desktopTab === 'visualizer' && (
                <div className="flex-1 min-h-0">
                  <AudioEqualizer isPlaying={isPlaying} />
                </div>
              )}
            </div>
          </section>
        </div>

        {showPlaylistPicker && (
          <PlaylistPicker tracks={[currentTrack]} onClose={() => setShowPlaylistPicker(false)} />
        )}
      </div>
    );
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-slate-800 to-slate-900 safe-area-top safe-area-bottom overscroll-none"
      style={{
        transform: dismissDragY > 0 ? `translateY(${dismissDragY}px)` : undefined,
        opacity: dismissDragY > 0 ? Math.max(0.6, 1 - dismissDragY / 600) : undefined,
        transition: dismissDragging ? 'none' : 'transform 0.2s ease-out, opacity 0.2s ease-out'
      }}
    >
      {ambientBackground && (metadata?.coverArt ?? storedCover) && (
        <>
          <img
            src={(metadata?.coverArt ?? storedCover)!}
            alt=""
            aria-hidden
            className="absolute inset-0 -z-10 w-full h-full object-cover scale-150 blur-3xl opacity-40 pointer-events-none"
          />
          <div className="absolute inset-0 -z-10 bg-gradient-to-b from-slate-900/20 via-slate-900/60 to-slate-900 pointer-events-none" aria-hidden />
        </>
      )}
      {/* Swipe down indicator */}
      {!showQueue && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 w-10 h-1 bg-slate-600 rounded-full" />
      )}

      {/* Header */}
      <header className="flex items-center justify-between p-4 pt-5">
        {showQueue ? (
          // Queue header - simplified with close button
          <>
            <div className="w-10" /> {/* Spacer for balance */}
            <div className="text-center">
              <p className="text-xs text-slate-400 uppercase">{t('Queue')}</p>
              <p className="text-sm text-white">{t('{count} tracks', { count: queue.length })}</p>
            </div>
            <button
              onClick={() => setShowQueue(false)}
              className="p-2 text-slate-400 hover:text-white transition-colors"
              title={t('Close queue')}
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
              <p className="text-xs text-slate-400 uppercase">{t('Now playing')}</p>
              <p className="text-sm text-white truncate max-w-[200px]">
                {currentTrack.channelName}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <SleepTimerButton />
              <button
                onClick={toggleEqualizer}
                className={`p-2 transition-colors ${showEqualizer ? 'text-emerald-400' : 'text-slate-400 hover:text-white'}`}
                title={t('Toggle equalizer')}
              >
                <Activity className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowPlaylistPicker(true)}
                className="p-2 text-slate-400 hover:text-white transition-colors"
                title={t('Add to playlist')}
              >
                <Plus className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowQueue(true)}
                className="p-2 text-slate-400 hover:text-white transition-colors"
              >
                <ListMusic className="w-5 h-5" />
              </button>
            </div>
          </>
        )}
      </header>

      {showQueue ? (
        <div className="flex-1 min-h-0 flex flex-col px-2">
          <QueueList coverArts={coverArts} active={showQueue} />
        </div>
      ) : (
        // Player View
        <>
          {/* Album Art with Flip and Swipe Gestures */}
          <div className="flex-1 flex items-center justify-center p-8">
            <div
              {...cardSwipeHandlers}
              onClick={!isSwiping ? handleFlip : undefined}
              className="w-full max-w-80 aspect-square cursor-pointer select-none touch-pan-y"
              style={{
                perspective: '1000px',
                transition: isSwiping ? 'none' : 'transform 0.3s ease-out, opacity 0.3s ease-out',
                ...getCardTransform()
              }}
            >
              <div
                className="relative w-full h-full transition-transform duration-500"
                style={{
                  transformStyle: 'preserve-3d',
                  transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)'
                }}
              >
                {/* Front - Album Art */}
                <div
                  className="absolute inset-0 bg-slate-700 rounded-2xl shadow-2xl flex items-center justify-center"
                  style={{ backfaceVisibility: 'hidden' }}
                >
                  {metadata?.coverArt ? (
                    <img
                      src={metadata.coverArt}
                      alt={t('Cover')}
                      className="w-full h-full object-cover rounded-2xl"
                    />
                  ) : (
                    <Music className="w-24 h-24 text-slate-500" />
                  )}
                  {/* Swipe hints */}
                  {queue.length > 1 && (
                    <>
                      <div className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400/50">
                        <SkipBack className="w-6 h-6" />
                      </div>
                      <div className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400/50">
                        <SkipForward className="w-6 h-6" />
                      </div>
                    </>
                  )}
                  {/* Tap hint */}
                  <div className="absolute bottom-3 left-0 right-0 text-center">
                    <span className="text-xs text-slate-400 bg-slate-800/80 px-3 py-1 rounded-full">
                      {showEqualizer ? t('Tap for visualizer') : t('Tap for details')}
                    </span>
                  </div>
                </div>

                {/* Back - Equalizer or Metadata */}
                <div
                  className="absolute inset-0 bg-slate-700 rounded-2xl shadow-2xl overflow-hidden"
                  style={{
                    backfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)'
                  }}
                >
                  {showEqualizer ? (
                    // Equalizer view
                    <AudioEqualizer isPlaying={isPlaying} />
                  ) : loadingMetadata ? (
                    <div className="flex flex-col items-center justify-center h-full p-5">
                      <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                      <p className="text-slate-400 text-sm mt-2">{t('Loading metadata...')}</p>
                    </div>
                  ) : metadata ? (
                    <div data-no-dismiss className="space-y-3 text-sm p-5 overflow-y-auto h-full">
                      <h3 className="text-emerald-400 font-semibold text-base mb-4">{t('Track info')}</h3>

                      {/* Tags section */}
                      {(metadata.title || metadata.artist || metadata.album) && (
                        <div className="space-y-2 pb-3 border-b border-slate-600">
                          {metadata.title && (
                            <MetadataRow label={t('Title')} value={metadata.title} />
                          )}
                          {metadata.artist && (
                            <MetadataRow label={t('Artist')} value={metadata.artist} />
                          )}
                          {metadata.album && (
                            <MetadataRow label={t('Album')} value={metadata.album} />
                          )}
                          {metadata.year && (
                            <MetadataRow label={t('Year')} value={metadata.year.toString()} />
                          )}
                          {metadata.genre && metadata.genre.length > 0 && (
                            <MetadataRow label={t('Genre')} value={metadata.genre.join(', ')} />
                          )}
                          {metadata.track?.no && (
                            <MetadataRow
                              label={t('Track')}
                              value={metadata.track.of ? `${metadata.track.no}/${metadata.track.of}` : metadata.track.no.toString()}
                            />
                          )}
                        </div>
                      )}

                      {/* Technical section */}
                      <div className="space-y-2 pt-1">
                        <h4 className="text-slate-400 text-xs uppercase">{t('Technical')}</h4>
                        {metadata.format && (
                          <MetadataRow label={t('Format')} value={metadata.format.toUpperCase()} />
                        )}
                        {metadata.codec && (
                          <MetadataRow label={t('Codec')} value={metadata.codec} />
                        )}
                        {metadata.bitrate && (
                          <MetadataRow label={t('Bitrate')} value={`${metadata.bitrate} kbps`} />
                        )}
                        {metadata.sampleRate && (
                          <MetadataRow label={t('Sample rate')} value={`${metadata.sampleRate} Hz`} />
                        )}
                        {metadata.channels && (
                          <MetadataRow label={t('Channels')} value={metadata.channels === 2 ? t('Stereo') : metadata.channels === 1 ? t('Mono') : `${metadata.channels}`} />
                        )}
                        {metadata.bitsPerSample && (
                          <MetadataRow label={t('Bit depth')} value={`${metadata.bitsPerSample} bit`} />
                        )}
                        {metadata.duration && (
                          <MetadataRow label={t('Duration')} value={formatDuration(metadata.duration)} />
                        )}
                        {metadata.fileSize && (
                          <MetadataRow label={t('Size')} value={formatFileSize(metadata.fileSize)} />
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 p-5">
                      <Music className="w-12 h-12 mb-2 opacity-50" />
                      <p className="text-sm">{t('No metadata available')}</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Track Info */}
          <div className="px-8 text-center">
            <h1 className="text-xl font-bold text-white truncate">
              {currentTrack.title || currentTrack.fileName}
            </h1>
            <p className="text-slate-400 mt-1">
              {currentTrack.artist || t('Unknown artist')}
            </p>
          </div>

          {/* Progress Bar */}
          <div className="px-8 mt-6">
            <div className="relative flex items-center">
              {/* Custom track: base + preloaded highlight + played fill */}
              <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-slate-700 overflow-hidden pointer-events-none">
                {getPreloadedRanges(bufferedRanges, cachedPercent, duration).map((range, i) => (
                  <div
                    key={i}
                    className="absolute inset-y-0 bg-slate-500"
                    style={{
                      left: `${(range.start / duration) * 100}%`,
                      width: `${((range.end - range.start) / duration) * 100}%`
                    }}
                  />
                ))}
                <div
                  className="absolute inset-y-0 left-0 bg-emerald-500"
                  style={{ width: `${duration > 0 ? (position / duration) * 100 : 0}%` }}
                />
              </div>
              <input
                type="range"
                min={0}
                max={duration || 100}
                value={position}
                onChange={handleSeek}
                className="w-full relative track-transparent"
              />
            </div>
            <div className="flex justify-between mt-2 text-xs text-slate-400 tabular-nums">
              <span>{formatDuration(position)}</span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="px-8 py-6">
            {/* Configurable ±N seconds skip buttons */}
            {skipButtonsEnabled && (
              <div className="flex items-center justify-center gap-10 mb-4">
                <button
                  onClick={() => seek(Math.max(0, position - skipBackSeconds))}
                  className="flex flex-col items-center text-slate-300 hover:text-white transition-colors"
                >
                  <RotateCcw className="w-6 h-6" />
                  <span className="text-[10px] mt-0.5 tabular-nums">{skipBackSeconds}s</span>
                </button>
                <button
                  onClick={() => seek(position + skipForwardSeconds)}
                  className="flex flex-col items-center text-slate-300 hover:text-white transition-colors"
                >
                  <RotateCw className="w-6 h-6" />
                  <span className="text-[10px] mt-0.5 tabular-nums">{skipForwardSeconds}s</span>
                </button>
              </div>
            )}
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
          tracks={[currentTrack]}
          onClose={() => setShowPlaylistPicker(false)}
        />
      )}
    </div>
  );
}

// Tags and technical data of the playing file (desktop details panel)
function TrackDetails({ metadata, loading, fileName }: { metadata: AudioMetadata | null; loading: boolean; fileName: string }) {
  if (loading && !metadata) {
    return (
      <div className="flex items-center gap-2 text-slate-400" role="status">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
        {t('Loading metadata...')}
      </div>
    );
  }
  if (!metadata) return <p className="text-slate-400">{t('No metadata available')}</p>;
  const channels = metadata.channels === 2 ? t('Stereo') : metadata.channels === 1 ? t('Mono') : metadata.channels ? String(metadata.channels) : null;
  const rows: [string, string | null | undefined][] = [
    [t('Title'), metadata.title],
    [t('Artist'), metadata.artist],
    [t('Album'), metadata.album],
    [t('Year'), metadata.year?.toString()],
    [t('Genre'), metadata.genre?.join(', ')],
    [t('Track'), metadata.track?.no ? (metadata.track.of ? `${metadata.track.no}/${metadata.track.of}` : String(metadata.track.no)) : null]
  ];
  const tech: [string, string | null | undefined][] = [
    [t('Format'), metadata.format?.toUpperCase()],
    [t('Codec'), metadata.codec],
    [t('Bitrate'), metadata.bitrate ? `${metadata.bitrate} kbps` : null],
    [t('Sample rate'), metadata.sampleRate ? `${metadata.sampleRate} Hz` : null],
    [t('Channels'), channels],
    [t('Bit depth'), metadata.bitsPerSample ? `${metadata.bitsPerSample} bit` : null],
    [t('Duration'), metadata.duration ? formatDuration(metadata.duration) : null],
    [t('Size'), metadata.fileSize ? formatFileSize(metadata.fileSize) : null],
    [t('File'), fileName]
  ];
  const block = (title: string, list: [string, string | null | undefined][]) => {
    const shown = list.filter(([, v]) => !!v) as [string, string][];
    if (shown.length === 0) return null;
    return (
      <div>
        <h3 className="mb-2 text-xs uppercase tracking-wide text-slate-500">{title}</h3>
        <dl className="divide-y divide-white/5 rounded-xl bg-white/5">
          {shown.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 px-4 py-2 text-sm">
              <dt className="text-slate-400 shrink-0">{label}</dt>
              <dd className="text-white text-right break-all">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
  };
  return (
    <div className="space-y-6">
      {block(t('Tags'), rows)}
      {block(t('Technical'), tech)}
    </div>
  );
}

// Helper component for metadata rows
function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-400 flex-shrink-0">{label}</span>
      <span className="text-white text-right truncate">{value}</span>
    </div>
  );
}
