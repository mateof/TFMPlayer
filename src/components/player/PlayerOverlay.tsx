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
  GripVertical,
  RotateCcw,
  RotateCw
} from 'lucide-react';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { formatDuration, formatFileSize } from '@/utils/format';
import { getPreloadedRanges } from '@/utils/preload';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PlaylistPicker } from '@/components/playlists/PlaylistPicker';
import { useUiStore } from '@/stores/uiStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { audioMetadataService, type AudioMetadata } from '@/services/audio/AudioMetadataService';
import { audioPlayer } from '@/services/audio/AudioPlayerService';
import { cacheService } from '@/services/cache/CacheService';
import { loadNextQueuePage } from '@/services/queue/QueueSourceService';
import { AudioEqualizer } from './AudioEqualizer';

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
  const moveInQueue = usePlayerStore((s) => s.moveInQueue);
  const queueSource = usePlayerStore((s) => s.queueSource);
  const skipButtonsEnabled = useSettingsStore((s) => s.skipButtonsEnabled);
  const skipBackSeconds = useSettingsStore((s) => s.skipBackSeconds);
  const skipForwardSeconds = useSettingsStore((s) => s.skipForwardSeconds);
  const [showQueue, setShowQueue] = useState(false);
  const [loadingMoreQueue, setLoadingMoreQueue] = useState(false);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  const [isFlipped, setIsFlipped] = useState(false);
  const [metadata, setMetadata] = useState<AudioMetadata | null>(null);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [coverArts, setCoverArts] = useState<Record<string, string>>({});
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
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
    bufferedRanges,
    cachedPercent,
    togglePlayPause,
    next,
    previous,
    skipToPrevious,
    seek,
    setVolume,
    toggleShuffle,
    cycleRepeatMode,
    playAtIndex
  } = useAudioPlayer();

  const handleClose = () => {
    setPlayerExpanded(false);
  };

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

  // Infinite scroll in the queue: page in more tracks from the queue's source
  const handleQueueScroll = async (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (!queueSource?.hasMore || loadingMoreQueue) return;

    const threshold = 200; // px from bottom
    if (el.scrollHeight - el.scrollTop - el.clientHeight < threshold) {
      setLoadingMoreQueue(true);
      try {
        await loadNextQueuePage();
      } catch (error) {
        console.warn('Failed to load more queue tracks:', error);
      } finally {
        setLoadingMoreQueue(false);
      }
    }
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

  // Set initial flip state based on showEqualizer preference
  useEffect(() => {
    if (showEqualizer) {
      setIsFlipped(true);
    }
  }, []);

  // Load metadata when track changes
  useEffect(() => {
    if (!currentTrack) {
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
  }, [currentTrack?.fileId]);

  // Load cover arts for queue tracks
  useEffect(() => {
    const loadCoverArts = async () => {
      const newCoverArts: Record<string, string> = {};

      for (const track of queue) {
        // Skip if already loaded
        if (coverArts[track.fileId]) {
          newCoverArts[track.fileId] = coverArts[track.fileId];
          continue;
        }

        // Try to get from cache
        const cached = await cacheService.getCoverArt(track.fileId);
        if (cached) {
          newCoverArts[track.fileId] = cached;
        }
      }

      if (Object.keys(newCoverArts).length > 0) {
        setCoverArts(prev => ({ ...prev, ...newCoverArts }));
      }
    };

    if (queue.length > 0) {
      loadCoverArts();
    }
  }, [queue]);

  // Drag and drop handlers for queue reordering
  const handleDragStart = useCallback((e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = draggedIndex;
    setDraggedIndex(null);
    setDragOverIndex(null);

    if (fromIndex !== null && fromIndex !== toIndex) {
      moveInQueue(fromIndex, toIndex);
    }
  }, [draggedIndex, moveInQueue]);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

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
            <div className="flex items-center gap-1">
              <button
                onClick={toggleEqualizer}
                className={`p-2 transition-colors ${showEqualizer ? 'text-emerald-400' : 'text-slate-400 hover:text-white'}`}
                title="Toggle equalizer"
              >
                <Activity className="w-5 h-5" />
              </button>
              <button
                onClick={() => setShowPlaylistPicker(true)}
                className="p-2 text-slate-400 hover:text-white transition-colors"
                title="Add to playlist"
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
        // Queue View - overscroll-none prevents pull-to-refresh
        <div
          ref={queueListRef}
          onScroll={handleQueueScroll}
          data-no-dismiss
          className="flex-1 overflow-y-auto px-4 overscroll-none"
        >
          <div className="space-y-2 pb-4">
            {queue.map((track, index) => (
              <div
                key={`${track.fileId}-${index}`}
                data-index={index}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={`w-full flex items-center gap-2 p-3 rounded-lg transition-all cursor-grab active:cursor-grabbing ${
                  index === currentIndex
                    ? 'bg-emerald-500/20 border border-emerald-500/50'
                    : 'bg-slate-800 hover:bg-slate-700'
                } ${draggedIndex === index ? 'opacity-50 scale-95' : ''} ${
                  dragOverIndex === index && draggedIndex !== index
                    ? 'border-t-2 border-emerald-400'
                    : ''
                }`}
              >
                <div className="text-slate-500 cursor-grab active:cursor-grabbing touch-none">
                  <GripVertical className="w-4 h-4" />
                </div>
                <span className="w-6 text-center text-slate-400 text-sm">
                  {index + 1}
                </span>
                <div
                  className="w-10 h-10 bg-slate-700 rounded flex items-center justify-center flex-shrink-0 overflow-hidden"
                  onClick={() => playAtIndex(index)}
                >
                  {coverArts[track.fileId] ? (
                    <img
                      src={coverArts[track.fileId]}
                      alt="Cover"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Music className="w-5 h-5 text-slate-400" />
                  )}
                </div>
                <div
                  className="flex-1 min-w-0 text-left cursor-pointer"
                  onClick={() => playAtIndex(index)}
                >
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
              </div>
            ))}

            {/* Infinite scroll: more tracks available from the channel */}
            {loadingMoreQueue && (
              <div className="flex items-center justify-center py-3 gap-2 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-xs">Loading more...</span>
              </div>
            )}
            {!loadingMoreQueue && queueSource?.hasMore && (
              <p className="py-3 text-center text-xs text-slate-500">
                Scroll down to load more from {queueSource.channelName}
              </p>
            )}
          </div>
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
                      alt="Cover"
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
                      {showEqualizer ? 'Tap for visualizer' : 'Tap for details'}
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
                      <p className="text-slate-400 text-sm mt-2">Loading metadata...</p>
                    </div>
                  ) : metadata ? (
                    <div data-no-dismiss className="space-y-3 text-sm p-5 overflow-y-auto h-full">
                      <h3 className="text-emerald-400 font-semibold text-base mb-4">Track Info</h3>

                      {/* Tags section */}
                      {(metadata.title || metadata.artist || metadata.album) && (
                        <div className="space-y-2 pb-3 border-b border-slate-600">
                          {metadata.title && (
                            <MetadataRow label="Title" value={metadata.title} />
                          )}
                          {metadata.artist && (
                            <MetadataRow label="Artist" value={metadata.artist} />
                          )}
                          {metadata.album && (
                            <MetadataRow label="Album" value={metadata.album} />
                          )}
                          {metadata.year && (
                            <MetadataRow label="Year" value={metadata.year.toString()} />
                          )}
                          {metadata.genre && metadata.genre.length > 0 && (
                            <MetadataRow label="Genre" value={metadata.genre.join(', ')} />
                          )}
                          {metadata.track?.no && (
                            <MetadataRow
                              label="Track"
                              value={metadata.track.of ? `${metadata.track.no}/${metadata.track.of}` : metadata.track.no.toString()}
                            />
                          )}
                        </div>
                      )}

                      {/* Technical section */}
                      <div className="space-y-2 pt-1">
                        <h4 className="text-slate-400 text-xs uppercase">Technical</h4>
                        {metadata.format && (
                          <MetadataRow label="Format" value={metadata.format.toUpperCase()} />
                        )}
                        {metadata.codec && (
                          <MetadataRow label="Codec" value={metadata.codec} />
                        )}
                        {metadata.bitrate && (
                          <MetadataRow label="Bitrate" value={`${metadata.bitrate} kbps`} />
                        )}
                        {metadata.sampleRate && (
                          <MetadataRow label="Sample Rate" value={`${metadata.sampleRate} Hz`} />
                        )}
                        {metadata.channels && (
                          <MetadataRow label="Channels" value={metadata.channels === 2 ? 'Stereo' : metadata.channels === 1 ? 'Mono' : `${metadata.channels}`} />
                        )}
                        {metadata.bitsPerSample && (
                          <MetadataRow label="Bit Depth" value={`${metadata.bitsPerSample} bit`} />
                        )}
                        {metadata.duration && (
                          <MetadataRow label="Duration" value={formatDuration(metadata.duration)} />
                        )}
                        {metadata.fileSize && (
                          <MetadataRow label="Size" value={formatFileSize(metadata.fileSize)} />
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center h-full text-slate-400 p-5">
                      <Music className="w-12 h-12 mb-2 opacity-50" />
                      <p className="text-sm">No metadata available</p>
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
              {currentTrack.artist || 'Unknown Artist'}
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
          track={currentTrack}
          onClose={() => setShowPlaylistPicker(false)}
        />
      )}
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
