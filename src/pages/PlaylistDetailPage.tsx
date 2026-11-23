import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Play, Shuffle, Download, Music, Trash2, Check, CloudOff, Cloud, WifiOff, GripVertical, ChevronUp } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/common/Button';
import { LoadingScreen } from '@/components/common/Spinner';
import { TrackContextMenu } from '@/components/common/TrackContextMenu';
import { playlistsApi } from '@/services/api/playlists.api';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useLongPress } from '@/hooks/useLongPress';
import { useUiStore } from '@/stores/uiStore';
import { formatDuration, formatFileSize } from '@/utils/format';
import { downloadManager, useDownloadStore } from '@/services/download/DownloadManager';
import { cacheService } from '@/services/cache/CacheService';
import {
  getOfflinePlaylist,
  saveOfflinePlaylist,
  deleteOfflinePlaylist,
  getApiCache,
  db,
  type OfflinePlaylistEntity
} from '@/db/database';
import type { PlaylistDetail, Track } from '@/types/models';
import { confirmDialog } from '@/components/common/confirm';
import { t } from '@/i18n';

const detailKey = (id: string) => ['playlists', id, 'detail'] as const;

export function PlaylistDetailPage() {
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const { addToast } = useUiStore();
  const { play, playNext, currentTrack, isPlaying } = useAudioPlayer();
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
  const [syncing, setSyncing] = useState(false);
  const [togglingOffline, setTogglingOffline] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [contextMenuTrack, setContextMenuTrack] = useState<Track | null>(null);

  // Long press opens the track menu
  const longPress = useLongPress<Track>(useCallback((track: Track) => setContextMenuTrack(track), []));
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

  // Only the visible rows are rendered: big playlists (thousands of tracks)
  // used to build every row up front
  const trackListRef = useRef<HTMLDivElement>(null);
  const [trackListOffset, setTrackListOffset] = useState(0);
  useLayoutEffect(() => {
    // Rows start below the playlist header, inside the same scroller (made
    // `relative` so it is the offsetParent); banners shift that start
    const offset = trackListRef.current?.offsetTop ?? 0;
    if (offset !== trackListOffset) setTrackListOffset(offset);
  }, [trackListOffset, loading, playlist, isOfflineMode, syncing, isOffline]);
  const trackVirtualizer = useVirtualizer({
    count: playlist?.tracks.length ?? 0,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 73,
    overscan: 10,
    scrollMargin: trackListOffset
  });

  const scrollToTop = useCallback(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Immediately update cache status when downloads complete
  useEffect(() => {
    if (!playlist?.tracks.length) return;

    // Check if any completed download belongs to this playlist
    const completedInPlaylist = playlist.tracks.filter(tr => completedDownloads.has(tr.fileId));
    if (completedInPlaylist.length > 0) {
      // Immediately add to cached set
      setCachedTrackIds(prev => {
        const newSet = new Set(prev);
        completedInPlaylist.forEach(tr => newSet.add(tr.fileId));
        return newSet;
      });
      // Clear the completed flags
      completedInPlaylist.forEach(tr => clearCompleted(tr.fileId));
      // Also update full cache status (for cover art, duration, etc.)
      updateCacheStatus(playlist.tracks);
    }
  }, [completedDownloads, playlist?.tracks, clearCompleted]);

  // Refresh cache status periodically when downloads are active
  useEffect(() => {
    if (!playlist?.tracks.length) return;

    const interval = setInterval(async () => {
      // Only refresh if there are active downloads for tracks in this playlist
      const hasActiveDownloads = playlist.tracks.some(tr => activeDownloads.has(tr.fileId));
      if (hasActiveDownloads) {
        await updateCacheStatus(playlist.tracks);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [playlist?.tracks, activeDownloads.size]);

  // Map an offline-saved playlist to the shape the page renders
  const offlineToDetail = (data: OfflinePlaylistEntity): PlaylistDetail => ({
    id: data.id,
    name: data.name,
    description: data.description,
    trackCount: data.trackCount,
    tracks: JSON.parse(data.tracksJson) as Track[],
    dateCreated: data.savedAt.toISOString(),
    dateModified: data.lastSyncedAt?.toISOString() || data.savedAt.toISOString()
  });

  // Cache-first: render local data instantly (offline copy, or the detail
  // cached on the last visit), then refresh from the server in the
  // background. Navigation never waits for the network.
  const loadPlaylist = async () => {
    setLoading(true);

    // Check if playlist is saved offline
    const offlineData = await getOfflinePlaylist(id!);
    setIsOffline(!!offlineData);

    // Offline copy first, then the persisted react-query cache, then the
    // cache written by versions before react-query
    const cachedDetail = offlineData
      ? offlineToDetail(offlineData)
      : queryClient.getQueryData<PlaylistDetail>(detailKey(id!))
        ?? await getApiCache<PlaylistDetail>(`playlist-detail:${id}`);

    const renderedFromCache = !!cachedDetail;
    if (cachedDetail) {
      setPlaylist(cachedDetail);
      // Read-only until the server confirms the data is current
      setIsOfflineMode(true);
      setLoading(false);
      updateCacheStatus(cachedDetail.tracks);
    }

    await syncFromServer(offlineData, renderedFromCache);
    if (!renderedFromCache) setLoading(false);
  };

  const syncFromServer = async (
    offlineData: OfflinePlaylistEntity | undefined,
    renderedFromCache: boolean
  ) => {
    setSyncing(true);
    try {
      // Through react-query: shared and persisted cache, one request even if
      // several screens ask at once
      const data = await queryClient.fetchQuery({
        queryKey: detailKey(id!),
        queryFn: () => playlistsApi.getById(id!),
        staleTime: 0,
        meta: { persist: true }
      });
      setPlaylist(data);
      setIsOfflineMode(false);

      // Update offline cache if it exists and auto-download new tracks
      if (offlineData) {
        // Find new tracks that weren't in the offline version
        const oldTrackIds = new Set(
          (JSON.parse(offlineData.tracksJson) as Track[]).map(tr => tr.fileId)
        );
        const newTracks = data.tracks.filter(tr => !oldTrackIds.has(tr.fileId));

        // Save updated playlist
        await saveOfflinePlaylist(id!, data.name, data.description, data.tracks);

        // Queue new tracks for download (one bulk cache lookup)
        if (newTracks.length > 0) {
          const cached = await cacheService.getCachedTrackIds(newTracks.map(tr => tr.fileId));
          const missing = newTracks.filter(tr => !cached.has(tr.fileId));
          if (missing.length > 0) {
            await downloadManager.addMultipleToQueue(missing);
            addToast(t('{count} new track(s) queued for download', { count: missing.length }), 'info');
          }
        }
      }

      // Check which tracks are cached
      await updateCacheStatus(data.tracks);
    } catch (error) {
      console.error('Failed to load from server:', error);

      if (renderedFromCache) {
        // Already showing the cached copy: just stay in offline mode
        setIsOfflineMode(true);
      } else {
        addToast(t('Failed to load playlist'), 'error');
      }
    } finally {
      setSyncing(false);
    }
  };

  const updateCacheStatus = async (tracks: Track[]) => {
    const cachedIds = new Set<string>();
    const newCoverArts: Record<string, string> = {};
    const newDurations: Record<string, number> = {};

    // Single bulk read instead of one IndexedDB transaction per track
    const cachedEntries = await db.cachedTracks.bulkGet(tracks.map(tr => tr.fileId));
    cachedEntries.forEach((cachedTrack, i) => {
      const track = tracks[i];
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
    });

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
      const trackIds = newTracks.map(tr => tr.fileId);
      await playlistsApi.reorderTracks(id!, trackIds);

      // Update offline playlist if saved
      if (isOffline) {
        await saveOfflinePlaylist(id!, playlist.name, playlist.description, newTracks);
      }
    } catch (error) {
      console.error('Failed to reorder tracks:', error);
      addToast(t('Failed to save track order'), 'error');
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
        const shouldRemoveTracks = await confirmDialog({
          title: t('Remove the downloaded tracks too?'),
          message: t('The playlist is no longer kept offline. Its tracks can also be deleted from this device to free space.'),
          confirmLabel: t('Delete tracks'),
          cancelLabel: t('Keep them'),
          danger: true
        });
        if (shouldRemoveTracks) {
          await db.cachedTracks.bulkDelete(playlist.tracks.map(tr => tr.fileId));
          setCachedTrackIds(new Set());
        }

        setIsOffline(false);
        addToast(t('Playlist removed from offline'), 'success');
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
          addToast(t('Playlist saved for offline. Downloading {count} tracks...', { count: tracksToDownload.length }), 'success');
        } else {
          addToast(t('Playlist saved for offline (all tracks already cached)'), 'success');
        }
      }
    } catch (error) {
      console.error('Error toggling offline:', error);
      addToast(t('Failed to update offline status'), 'error');
    } finally {
      setTogglingOffline(false);
    }
  };

  const handleDownloadTrack = async (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();
    await downloadManager.addToQueue(track);
    addToast(t('Added to download queue'), 'info');
  };

  const handlePlayTrack = (track: Track, index: number) => {
    if (longPress.consumeLongPress()) return;
    if (!playlist) return;
    play(track, playlist.tracks, index);
  };

  // Keyboard reordering (Alt+Up/Down), the accessible twin of drag and drop
  const moveTrack = async (fromIndex: number, toIndex: number) => {
    if (!playlist || isOfflineMode) return;
    if (toIndex < 0 || toIndex >= playlist.tracks.length || fromIndex === toIndex) return;
    const newTracks = [...playlist.tracks];
    const [moved] = newTracks.splice(fromIndex, 1);
    newTracks.splice(toIndex, 0, moved);
    setPlaylist({ ...playlist, tracks: newTracks });
    try {
      await playlistsApi.reorderTracks(id!, newTracks.map(tr => tr.fileId));
      if (isOffline) await saveOfflinePlaylist(id!, playlist.name, playlist.description, newTracks);
    } catch (error) {
      console.error('Failed to reorder tracks:', error);
      addToast(t('Failed to save track order'), 'error');
      loadPlaylist();
    }
  };

  const focusTrackRow = (index: number) => {
    if (!playlist || index < 0 || index >= playlist.tracks.length) return;
    trackVirtualizer.scrollToIndex(index, { align: 'auto' });
    requestAnimationFrame(() => {
      scrollContainerRef.current
        ?.querySelector<HTMLElement>(`[data-track-index="${index}"]`)
        ?.focus();
    });
  };

  const handleTrackKeyDown = (track: Track, index: number, e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget) return; // a button inside the row has focus
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handlePlayTrack(track, index);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      const target = e.key === 'ArrowDown' ? index + 1 : index - 1;
      if (e.altKey) moveTrack(index, target);
      focusTrackRow(target);
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      setContextMenuTrack(track);
    }
  };

  const handlePlayNext = (track: Track) => {
    playNext(track);
    addToast(t('"{name}" will play next', { name: track.title || track.fileName }), 'info');
  };

  const handleRemoveTrack = async (track: Track, e: React.MouseEvent) => {
    e.stopPropagation();

    if (isOfflineMode) {
      addToast(t('Cannot modify playlist while offline'), 'error');
      return;
    }

    if (!(await confirmDialog({
      message: t('Remove "{name}" from the playlist?', { name: track.title || track.fileName }),
      confirmLabel: t('Remove'),
      danger: true
    }))) return;

    try {
      await playlistsApi.removeTrack(id!, track.fileId);
      addToast(t('Track removed'), 'success');
      loadPlaylist();
    } catch {
      addToast(t('Failed to remove track'), 'error');
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col min-h-screen lg:min-h-0">
        <Header title={t('Playlist')} showBack />
        <LoadingScreen message={t('Loading playlist...')} />
      </div>
    );
  }

  if (!playlist) {
    return (
      <div className="flex flex-col min-h-screen lg:min-h-0">
        <Header title={t('Playlist')} showBack />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-slate-400">{t('Playlist not found')}</p>
        </div>
      </div>
    );
  }

  // Calculate total duration - use cached durations when available
  const totalDuration = playlist.tracks.reduce((acc, tr) => {
    const duration = cachedDurations[tr.fileId] || tr.duration || 0;
    return acc + duration;
  }, 0);
  const totalSize = playlist.tracks.reduce((acc, tr) => acc + tr.fileSize, 0);
  const cachedCount = cachedTrackIds.size;

  return (
    <div className="flex flex-col h-screen lg:h-full overflow-hidden">
      <Header title={playlist.name} subtitle={playlist.description} showBack />

      {/* Scrollable content */}
      <div ref={scrollContainerRef} className="relative flex-1 overflow-y-auto">
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
                  {t('{count} tracks', { count: playlist.trackCount })}{totalDuration > 0 ? ` • ${formatDuration(totalDuration)}` : ''}
                </p>
              </div>
              <button
                onClick={handlePlayAll}
                disabled={!playlist.tracks.length}
                aria-label={t('Play all')}
                className="p-2 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors"
              >
                <Play className="w-4 h-4 text-white" fill="currentColor" />
              </button>
              <button
                onClick={handleShufflePlay}
                disabled={!playlist.tracks.length}
                aria-label={t('Shuffle play')}
                className="p-2 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors"
              >
                <Shuffle className="w-4 h-4 text-white" />
              </button>
              <button
                onClick={handleToggleOffline}
                disabled={isOfflineMode || togglingOffline}
                aria-label={isOffline ? t('Remove offline copy') : t('Save for offline')}
                aria-pressed={isOffline}
                className={`p-2 ${isOffline ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-slate-700 hover:bg-slate-600'} disabled:opacity-50 disabled:cursor-not-allowed rounded-full transition-colors`}
              >
                {isOffline ? <CloudOff className="w-4 h-4 text-white" /> : <Cloud className="w-4 h-4 text-white" />}
              </button>
            </div>
          </div>
        </div>
        {/* Offline mode indicator (hidden while the background sync is
            still deciding whether the server is reachable) */}
        {isOfflineMode && !syncing && (
          <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 text-amber-400 text-sm">
            <WifiOff className="w-4 h-4" />
            <span>{t('Offline mode')}</span>
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
                {t('{count} tracks', { count: playlist.trackCount })}{totalDuration > 0 ? ` • ${formatDuration(totalDuration)}` : ''}
              </p>
              <p className="text-slate-500 text-xs">{formatFileSize(totalSize)}</p>
              {cachedCount > 0 && (
                <p className="text-emerald-400 text-xs mt-1">
                  {t('{cached}/{total} on device', { cached: cachedCount, total: playlist.tracks.length })}
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
              {t('Play All')}
            </Button>
            <Button
              variant="secondary"
              icon={<Shuffle className="w-4 h-4" />}
              onClick={handleShufflePlay}
              disabled={!playlist.tracks.length}
            >
              {t('Shuffle')}
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
              {isOffline ? t('Remove Offline') : t('Save Offline')}
            </Button>
          </div>
        </div>

        {/* Track List */}
        <div className="pb-32">
        {playlist.tracks.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Music className="w-12 h-12 mb-4 opacity-50" />
            <p>{t('No tracks in this playlist')}</p>
            <p className="text-sm mt-2">{t('Add tracks from channels')}</p>
          </div>
        ) : (
          <div
            ref={trackListRef}
            role="list"
            aria-label={t('{count} tracks. Alt+arrows reorder, Shift+F10 opens options', { count: playlist.tracks.length })}
            className="relative"
            style={{ height: trackVirtualizer.getTotalSize() }}
          >
            {trackVirtualizer.getVirtualItems().map((virtualRow) => {
              const index = virtualRow.index;
              const track = playlist.tracks[index];
              const isCurrentTrack = currentTrack?.fileId === track.fileId;
              const isCached = cachedTrackIds.has(track.fileId);
              const coverArt = coverArts[track.fileId];
              return (
                <div
                  key={track.fileId}
                  data-index={index}
                  data-track-index={index}
                  ref={trackVirtualizer.measureElement}
                  role="listitem"
                  tabIndex={0}
                  aria-current={isCurrentTrack ? 'true' : undefined}
                  aria-label={`${index + 1}. ${track.title || track.fileName}${isCached ? t(', on device') : ''}`}
                  onKeyDown={(e) => handleTrackKeyDown(track, index, e)}
                  style={{ transform: `translateY(${virtualRow.start - trackVirtualizer.options.scrollMargin}px)` }}
                  draggable={!isOfflineMode}
                  onDragOver={(e) => handleDragOver(e, index)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, index)}
                  onDragEnd={handleDragEnd}
                  {...longPress.bind(track)}
                  onDragStart={(e) => handleDragStart(e, index)}
                  className={`absolute left-0 top-0 border-b border-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 w-full flex items-center gap-3 p-4 transition-all touch-manipulation text-left select-none ${
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
                      <img src={coverArt} alt={t('Cover')} className="w-full h-full object-cover rounded-lg" />
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
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        className="p-2 text-slate-500 hover:text-emerald-400 transition-colors"
                        title={t('Download')}
                        aria-label={t('Download {name}', { name: track.title || track.fileName })}
                      >
                        <Download className="w-4 h-4" aria-hidden />
                      </button>
                    )
                  )}
                  {!isOfflineMode && (
                    <button
                      onClick={(e) => handleRemoveTrack(track, e)}
                      onMouseDown={(e) => e.stopPropagation()}
                      onTouchStart={(e) => e.stopPropagation()}
                      className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                      aria-label={t('Remove {name} from the playlist', { name: track.title || track.fileName })}
                      title={t('Remove')}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden />
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
          className="fixed bottom-24 right-4 lg:bottom-28 lg:right-8 p-3 bg-emerald-500 hover:bg-emerald-600 rounded-full shadow-lg transition-all z-30"
          aria-label={t('Scroll to top')}
        >
          <ChevronUp className="w-5 h-5 text-white" />
        </button>
      )}

      {/* Track Context Menu */}
      {contextMenuTrack && (
        <TrackContextMenu
          track={contextMenuTrack}
          onClose={() => setContextMenuTrack(null)}
          onPlayNext={handlePlayNext}
          coverArt={coverArts[contextMenuTrack.fileId]}
        />
      )}
    </div>
  );
}
