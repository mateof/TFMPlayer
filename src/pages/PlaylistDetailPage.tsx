import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Play, Shuffle, Download, Music, Trash2, Check, CloudOff, Cloud, WifiOff, GripVertical, ChevronUp } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/common/Button';
import { LoadingScreen } from '@/components/common/Spinner';
import { playlistsApi } from '@/services/api/playlists.api';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useUiStore } from '@/stores/uiStore';
import { formatDuration, formatFileSize } from '@/utils/format';
import { downloadManager, useDownloadStore } from '@/services/download/DownloadManager';
import { cacheService } from '@/services/cache/CacheService';
import {
  getOfflinePlaylist,
  saveOfflinePlaylist,
  deleteOfflinePlaylist,
  db
} from '@/db/database';
import type { PlaylistDetail, Track } from '@/types/models';

export function PlaylistDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { addToast } = useUiStore();
  const { play, currentTrack, isPlaying } = useAudioPlayer();
  const activeDownloads = useDownloadStore((state) => state.activeDownloads);
  const completedDownloads = useDownloadStore((state) => state.completedDownloads);
  const clearCompleted = useDownloadStore((state) => state.clearCompleted);

  const [loading, setLoading] = useState(true);
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [cachedTrackIds, setCachedTrackIds] = useState<Set<string>>(new Set());
  const [coverArts, setCoverArts] = useState<Record<string, string>>({});
  const [cachedDurations, setCachedDurations] = useState<Record<string, number>>({});
  const [isOffline, setIsOffline] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [togglingOffline, setTogglingOffline] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const headerInfoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (id) {
      loadPlaylist();
    }
  }, [id]);

  // Scroll event handler for compact header and scroll-to-top button
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const scrollTop = container.scrollTop;
      // Show compact header when scrolled past 200px (after playlist info section)
      setIsScrolled(scrollTop > 200);
      // Show scroll to top button when scrolled past 100px
      setShowScrollTop(scrollTop > 100);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loading]);

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Immediately update cache status when downloads complete
  useEffect(() => {
    if (!playlist?.tracks.length) return;

    // Check if any completed download belongs to this playlist
    const completedInPlaylist = playlist.tracks.filter(t => completedDownloads.has(t.fileId));
    if (completedInPlaylist.length > 0) {
      // Immediately add to cached set
      setCachedTrackIds(prev => {
        const newSet = new Set(prev);
        completedInPlaylist.forEach(t => newSet.add(t.fileId));
        return newSet;
      });
      // Clear the completed flags
      completedInPlaylist.forEach(t => clearCompleted(t.fileId));
      // Also update full cache status (for cover art, duration, etc.)
      updateCacheStatus(playlist.tracks);
    }
  }, [completedDownloads, playlist?.tracks, clearCompleted]);

  // Refresh cache status periodically when downloads are active
  useEffect(() => {
    if (!playlist?.tracks.length) return;

    const interval = setInterval(async () => {
      // Only refresh if there are active downloads for tracks in this playlist
      const hasActiveDownloads = playlist.tracks.some(t => activeDownloads.has(t.fileId));
      if (hasActiveDownloads) {
        await updateCacheStatus(playlist.tracks);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [playlist?.tracks, activeDownloads.size]);

  const loadPlaylist = async () => {
    setLoading(true);

    // Check if playlist is saved offline
    const offlineData = await getOfflinePlaylist(id!);
    setIsOffline(!!offlineData);

    try {
      // Try to load from server
      const data = await playlistsApi.getById(id!);
      setPlaylist(data);
      setIsOfflineMode(false);

      // Update offline cache if it exists and auto-download new tracks
      if (offlineData) {
        // Find new tracks that weren't in the offline version
        const oldTrackIds = new Set(
          (JSON.parse(offlineData.tracksJson) as Track[]).map(t => t.fileId)
        );
        const newTracks = data.tracks.filter(t => !oldTrackIds.has(t.fileId));

        // Save updated playlist
        await saveOfflinePlaylist(id!, data.name, data.description, data.tracks);

        // Queue new tracks for download
        if (newTracks.length > 0) {
          for (const track of newTracks) {
            const isCached = await cacheService.isTrackCached(track.fileId);
            if (!isCached) {
              await downloadManager.addToQueue(track);
            }
          }
          addToast(`${newTracks.length} new track(s) queued for download`, 'info');
        }
      }

      // Check which tracks are cached
      await updateCacheStatus(data.tracks);
    } catch (error) {
      console.error('Failed to load from server:', error);

      // Try to load from offline cache
      if (offlineData) {
        const tracks = JSON.parse(offlineData.tracksJson) as Track[];
        setPlaylist({
          id: offlineData.id,
          name: offlineData.name,
          description: offlineData.description,
          trackCount: offlineData.trackCount,
          tracks,
          dateCreated: offlineData.savedAt.toISOString(),
          dateModified: offlineData.lastSyncedAt?.toISOString() || offlineData.savedAt.toISOString()
        });
        setIsOfflineMode(true);
        await updateCacheStatus(tracks);
        addToast('Offline mode - showing cached playlist', 'info');
      } else {
        addToast('Failed to load playlist', 'error');
      }
    } finally {
      setLoading(false);
    }
  };

  const updateCacheStatus = async (tracks: Track[]) => {
    const cachedIds = new Set<string>();
    const newCoverArts: Record<string, string> = {};
    const newDurations: Record<string, number> = {};

    for (const track of tracks) {
      const cachedTrack = await cacheService.getCachedTrack(track.fileId);
      if (cachedTrack?.blob) {
        cachedIds.add(track.fileId);
        // Load cover art and duration from cached tracks
        if (cachedTrack.coverArt) {
          newCoverArts[track.fileId] = cachedTrack.coverArt;
        }
        if (cachedTrack.duration) {
          newDurations[track.fileId] = cachedTrack.duration;
        }
      }
    }

    setCachedTrackIds(cachedIds);
    if (Object.keys(newCoverArts).length > 0) {
      setCoverArts(prev => ({ ...prev, ...newCoverArts }));
    }
    if (Object.keys(newDurations).length > 0) {
      setCachedDurations(prev => ({ ...prev, ...newDurations }));
    }
  };

  // Drag and drop handlers for track reordering
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

  const handleDrop = useCallback(async (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = draggedIndex;
    setDraggedIndex(null);
    setDragOverIndex(null);

    if (fromIndex === null || fromIndex === toIndex || !playlist || isOfflineMode) return;

    // Create new track order
    const newTracks = [...playlist.tracks];
    const [movedTrack] = newTracks.splice(fromIndex, 1);
    newTracks.splice(toIndex, 0, movedTrack);

    // Update local state immediately for responsiveness
    setPlaylist({ ...playlist, tracks: newTracks });

    // Save to server
    try {
      const trackIds = newTracks.map(t => t.fileId);
      await playlistsApi.reorderTracks(id!, trackIds);

      // Update offline playlist if saved
      if (isOffline) {
        await saveOfflinePlaylist(id!, playlist.name, playlist.description, newTracks);
      }
    } catch (error) {
      console.error('Failed to reorder tracks:', error);
      addToast('Failed to save track order', 'error');
      // Revert on error
      loadPlaylist();
    }
  }, [draggedIndex, playlist, isOfflineMode, id, isOffline, addToast]);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  const handlePlayAll = () => {
    if (!playlist?.tracks.length) return;
    play(playlist.tracks[0], playlist.tracks, 0);
  };

  const handleShufflePlay = () => {
    if (!playlist?.tracks.length) return;
    const shuffled = [...playlist.tracks].sort(() => Math.random() - 0.5);
    play(shuffled[0], shuffled, 0);
  };

  const handleToggleOffline = async () => {
    if (!playlist) return;

    setTogglingOffline(true);
    try {
      if (isOffline) {
        // Remove offline data
        await deleteOfflinePlaylist(id!);

        // Optionally remove cached tracks (ask user)
        const shouldRemoveTracks = confirm('Also remove downloaded tracks from cache?');
        if (shouldRemoveTracks) {
          for (const track of playlist.tracks) {
            await db.cachedTracks.delete(track.fileId);
          }
          setCachedTrackIds(new Set());
        }

        setIsOffline(false);
        addToast('Playlist removed from offline', 'success');
      } else {
        // Save for offline
        await saveOfflinePlaylist(id!, playlist.name, playlist.description, playlist.tracks);
        setIsOffline(true);

        // Start downloading all tracks
        const tracksToDownload = playlist.tracks.filter(
          (track) => !cachedTrackIds.has(track.fileId)
        );

        if (tracksToDownload.length > 0) {
          await downloadManager.addMultipleToQueue(tracksToDownload);
          addToast(`Playlist saved for offline. Downloading ${tracksToDownload.length} tracks...`, 'success');
        } else {
          addToast('Playlist saved for offline (all tracks already cached)', 'success');
        }
      }
    } catch (error) {
      console.error('Error toggling offline:', error);
      addToast('Failed to update offline status', 'error');
    } finally {
      setTogglingOffline(false);
    }
  };

  const handleDownloadTrack = async (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    await downloadManager.addToQueue(track);
    addToast('Added to download queue', 'info');
  };

  const handlePlayTrack = (track: Track, index: number) => {
    if (!playlist) return;
    play(track, playlist.tracks, index);
  };

  const handleRemoveTrack = async (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();

    if (isOfflineMode) {
      addToast('Cannot modify playlist while offline', 'error');
      return;
    }

    if (!confirm(`Remove "${track.title || track.fileName}" from playlist?`)) return;

    try {
      await playlistsApi.removeTrack(id!, track.fileId);
      addToast('Track removed', 'success');
      loadPlaylist();
    } catch {
      addToast('Failed to remove track', 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header title="Playlist" showBack />
        <LoadingScreen message="Loading playlist..." />
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="flex flex-col min-h-screen">
        <Header title="Playlist" showBack />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-400">Playlist not found</p>
        </div>
      </div>
    );
  }

  // Calculate total duration - use cached durations when available
  const totalDuration = playlist.tracks.reduce((acc, t) => {
    const duration = cachedDurations[t.fileId] || t.duration || 0;
    return acc + duration;
  }, 0);
  const totalSize = playlist.tracks.reduce((acc, t) => acc + t.fileSize, 0);
  const cachedCount = cachedTrackIds.size;

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <Header title={playlist.name} subtitle={playlist.description} showBack />

      {/* Scrollable content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {/* Compact sticky header - appears when scrolled */}
        <div className={`sticky top-0 z-20 transition-all duration-200 ${isScrolled ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full pointer-events-none'}`}>
          <div className="bg-slate-900/95 backdrop-blur-sm border-b border-slate-700 px-4 py-2">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-cyan-500 rounded-lg flex items-center justify-center flex-shrink-0">
                <Music className="w-5 h-5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-white font-semibold text-sm truncate">{playlist.name}</p>
                <p className="text-slate-400 text-xs">
                  {playlist.trackCount} tracks{totalDuration > 0 ? ` • ${formatDuration(totalDuration)}` : ''}
                </p>
              </div>
              <button
                onClick={handlePlayAll}
                disabled={!playlist.tracks.length}
                className="p-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors"
              >
                <Play className="w-4 h-4 text-white" fill="currentColor" />
              </button>
              <button
                onClick={handleShufflePlay}
                disabled={!playlist.tracks.length}
                className="p-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors"
              >
                <Shuffle className="w-4 h-4 text-white" />
              </button>
              <button
                onClick={handleToggleOffline}
                disabled={isOfflineMode || togglingOffline}
                className={`p-2 ${isOffline ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-slate-700 hover:bg-slate-600'} disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors`}
              >
                {isOffline ? <CloudOff className="w-4 h-4 text-white" /> : <Cloud className="w-4 h-4 text-white" />}
              </button>
            </div>
          </div>
        </div>
        {/* Offline mode indicator */}
        {isOfflineMode && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 text-amber-400 text-sm">
            <WifiOff className="w-4 h-4" />
            <span>Offline mode</span>
          </div>
        )}

        {/* Playlist Info & Actions */}
        <div ref={headerInfoRef} className="p-4 bg-gradient-to-b from-slate-800 to-transparent">
          <div className="flex items-center gap-4 mb-4">
            <div className="w-24 h-24 bg-gradient-to-br from-emerald-500 to-cyan-500 rounded-xl flex items-center justify-center shadow-lg relative">
              <Music className="w-10 h-10 text-white" />
              {isOffline && (
                <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                  <CloudOff className="w-4 h-4 text-white" />
                </div>
              )}
            </div>
            <div className="flex-1">
              <p className="text-white font-bold text-xl">{playlist.name}</p>
              <p className="text-slate-400 text-sm">
                {playlist.trackCount} tracks{totalDuration > 0 ? ` • ${formatDuration(totalDuration)}` : ''}
              </p>
              <p className="text-slate-500 text-xs">{formatFileSize(totalSize)}</p>
              {cachedCount > 0 && (
                <p className="text-emerald-400 text-xs mt-1">
                  {cachedCount}/{playlist.tracks.length} cached
                </p>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-3">
            <Button
              variant="primary"
              icon={<Play className="w-4 h-4" fill="currentColor" />}
              onClick={handlePlayAll}
              disabled={!playlist.tracks.length}
              className="flex-1"
            >
              Play All
            </Button>
            <Button
              variant="secondary"
              icon={<Shuffle className="w-4 h-4" />}
              onClick={handleShufflePlay}
              disabled={!playlist.tracks.length}
            >
              Shuffle
            </Button>
          </div>

          {/* Offline toggle button */}
          <div className="flex flex-wrap gap-3 mt-3">
            <Button
              variant={isOffline ? 'primary' : 'secondary'}
              icon={isOffline ? <CloudOff className="w-4 h-4" /> : <Cloud className="w-4 h-4" />}
              onClick={handleToggleOffline}
              loading={togglingOffline}
              disabled={isOfflineMode}
              className="flex-1"
            >
              {isOffline ? 'Remove Offline' : 'Save Offline'}
            </Button>
          </div>
        </div>

        {/* Track List */}
        <div className="pb-32">
        {playlist.tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Music className="w-12 h-12 mb-4 opacity-50" />
            <p>No tracks in this playlist</p>
            <p className="text-sm mt-2">Add tracks from channels</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {playlist.tracks.map((track, index) => {
              const isCurrentTrack = currentTrack?.fileId === track.fileId;
              const isCached = cachedTrackIds.has(track.fileId);
              const coverArt = coverArts[track.fileId];
              return (
                <div
                  key={track.fileId}
                  draggable={!isOfflineMode}
                  onDragStart={(e) => handleDragStart(e, index)}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  className={`w-full flex items-center gap-3 p-4 transition-all touch-manipulation text-left ${
                    isCurrentTrack ? 'bg-emerald-500/10' : 'hover:bg-slate-800'
                  } ${draggedIndex === index ? 'opacity-50 scale-95' : ''} ${
                    dragOverIndex === index && draggedIndex !== index
                      ? 'border-t-2 border-emerald-400'
                      : ''
                  } ${!isOfflineMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
                >
                  {!isOfflineMode && (
                    <div className="text-slate-500 cursor-grab active:cursor-grabbing touch-none">
                      <GripVertical className="w-4 h-4" />
                    </div>
                  )}
                  <span className={`w-6 text-center text-sm ${isCurrentTrack ? 'text-emerald-400' : 'text-slate-500'}`}>
                    {isCurrentTrack && isPlaying ? (
                      <div className="flex justify-center gap-0.5">
                        <div className="w-1 h-3 bg-emerald-400 animate-pulse" />
                        <div className="w-1 h-3 bg-emerald-400 animate-pulse delay-75" />
                        <div className="w-1 h-3 bg-emerald-400 animate-pulse delay-150" />
                      </div>
                    ) : (
                      index + 1
                    )}
                  </span>
                  <div
                    className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center flex-shrink-0 relative cursor-pointer"
                    onClick={() => handlePlayTrack(track, index)}
                  >
                    {coverArt ? (
                      <img src={coverArt} alt="Cover" className="w-full h-full object-cover rounded-lg" />
                    ) : (
                      <Music className={`w-5 h-5 ${isCurrentTrack ? 'text-emerald-400' : 'text-slate-400'}`} />
                    )}
                    {isCached && (
                      <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center border border-slate-900">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </div>
                    )}
                  </div>
                  <div
                    className="flex-1 min-w-0 cursor-pointer"
                    onClick={() => handlePlayTrack(track, index)}
                  >
                    <p className={`text-sm truncate ${isCurrentTrack ? 'text-emerald-400' : 'text-white'}`}>
                      {track.title || track.fileName}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {track.artist || track.channelName}
                      {(cachedDurations[track.fileId] || track.duration) ? ` • ${formatDuration(cachedDurations[track.fileId] || track.duration || 0)}` : ''}
                    </p>
                  </div>
                  {/* Download status */}
                  {!isCached && (
                    activeDownloads.has(track.fileId) ? (
                      <span className="p-2 text-amber-400 text-xs tabular-nums">
                        {activeDownloads.get(track.fileId)}%
                      </span>
                    ) : (
                      <button
                        onClick={(e) => handleDownloadTrack(track, e)}
                        className="p-2 text-slate-500 hover:text-emerald-400 transition-colors"
                        title="Download"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    )
                  )}
                  {!isOfflineMode && (
                    <button
                      onClick={(e) => handleRemoveTrack(track, e)}
                      className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </div>
      </div>

      {/* Scroll to top button */}
      {showScrollTop && (
        <button
          onClick={scrollToTop}
          className="fixed bottom-24 right-4 p-3 bg-emerald-500 hover:bg-emerald-600 rounded-full shadow-lg transition-all z-30"
          aria-label="Scroll to top"
        >
          <ChevronUp className="w-5 h-5 text-white" />
        </button>
      )}
    </div>
  );
}
