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
  GripVertical
} from 'lucide-react';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { formatDuration, formatFileSize } from '@/utils/format';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { PlaylistPicker } from '@/components/playlists/PlaylistPicker';
import { useUiStore } from '@/stores/uiStore';
import { usePlayerStore } from '@/stores/playerStore';
import { audioMetadataService, type AudioMetadata } from '@/services/audio/AudioMetadataService';
import { audioPlayer } from '@/services/audio/AudioPlayerService';
import { cacheService } from '@/services/cache/CacheService';
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
  const [showQueue, setShowQueue] = useState(false);
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

    const loadMetadata = async () => {
      setLoadingMetadata(true);
      try {
        const meta = await audioMetadataService.getMetadata(
          currentTrack.fileId,
          currentTrack.streamUrl,
          currentTrack.fileSize
        );
        setMetadata(meta);

        // Update MediaSession cover art if available
        if (meta?.coverArt) {
          audioPlayer.updateCoverArt(meta.coverArt);
        }
      } catch (error) {
        console.error('Failed to load metadata:', error);
      } finally {
        setLoadingMetadata(false);
      }
    };

    // Delay loading slightly to let playback start first
    const timeout = setTimeout(loadMetadata, 500);
    return () => clearTimeout(timeout);
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

  // Swipe gestures for album art card
  const { handlers: cardSwipeHandlers, touchDelta, isSwiping, swipeDirection } = useSwipeGesture({
    onSwipeLeft: () => {
      if (queue.length > 1) next();
    },
    onSwipeRight: () => {
      if (queue.length > 1) previous();
    },
    onSwipeDown: handleClose,
    threshold: 80,
    verticalThreshold: 120
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
    } else if (swipeDirection === 'vertical' && touchDelta.y > 0) {
      const scale = 1 - touchDelta.y / 1000;
      const opacity = 1 - touchDelta.y / 300;
      return {
        transform: `translateY(${touchDelta.y}px) scale(${Math.max(0.8, scale)})`,
        opacity: Math.max(0.5, opacity)
      };
    }
    return {};
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gradient-to-b from-slate-800 to-slate-900 safe-area-top safe-area-bottom overscroll-none">
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
                    <div className="space-y-3 text-sm p-5 overflow-y-auto h-full">
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

// Helper component for metadata rows
function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-slate-400 flex-shrink-0">{label}</span>
      <span className="text-white text-right truncate">{value}</span>
    </div>
  );
}
