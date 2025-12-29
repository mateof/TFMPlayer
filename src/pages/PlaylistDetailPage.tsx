import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Play, Shuffle, Download, Music, Trash2, Check, CloudOff, Cloud, WifiOff } from 'lucide-react';
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

  const [loading, setLoading] = useState(true);
  const [playlist, setPlaylist] = useState<PlaylistDetail | null>(null);
  const [cachedTrackIds, setCachedTrackIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);
  const [isOffline, setIsOffline] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);
  const [togglingOffline, setTogglingOffline] = useState(false);

  useEffect(() => {
    if (id) {
      loadPlaylist();
    }
  }, [id]);

  // Refresh cache status when downloads complete
  useEffect(() => {
    if (!playlist?.tracks.length) return;

    const interval = setInterval(async () => {
      // Only refresh if there are active downloads for tracks in this playlist
      const hasActiveDownloads = playlist.tracks.some(t => activeDownloads.has(t.fileId));
      if (hasActiveDownloads || activeDownloads.size > 0) {
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

      // Update offline cache if it exists
      if (offlineData) {
        await saveOfflinePlaylist(id!, data.name, data.description, data.tracks);
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
    for (const track of tracks) {
      const isCached = await cacheService.isTrackCached(track.fileId);
      if (isCached) cachedIds.add(track.fileId);
    }
    setCachedTrackIds(cachedIds);
  };

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

  const handleDownloadAll = async () => {
    if (!playlist?.tracks.length) return;

    const tracksToDownload = playlist.tracks.filter(
      (track) => !cachedTrackIds.has(track.fileId)
    );

    if (tracksToDownload.length === 0) {
      addToast('All tracks already cached', 'info');
      return;
    }

    setDownloading(true);
    try {
      await downloadManager.addMultipleToQueue(tracksToDownload);
      addToast(`Added ${tracksToDownload.length} tracks to download queue`, 'success');
    } catch (error) {
      addToast('Failed to start downloads', 'error');
      console.error(error);
    } finally {
      setDownloading(false);
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

  const totalDuration = playlist.tracks.reduce((acc, t) => acc + (t.duration || 0), 0);
  const totalSize = playlist.tracks.reduce((acc, t) => acc + t.fileSize, 0);
  const cachedCount = cachedTrackIds.size;
  const allCached = cachedCount === playlist.tracks.length && playlist.tracks.length > 0;

  return (
    <div className="flex flex-col min-h-screen">
      <Header title={playlist.name} subtitle={playlist.description} showBack />

      {/* Offline mode indicator */}
      {isOfflineMode && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 text-amber-400 text-sm">
          <WifiOff className="w-4 h-4" />
          <span>Offline mode</span>
        </div>
      )}

      {/* Playlist Info & Actions */}
      <div className="p-4 bg-gradient-to-b from-slate-800 to-transparent">
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
              {playlist.trackCount} tracks • {formatDuration(totalDuration)}
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
      <div className="flex-1 overflow-y-auto">
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
              return (
                <div
                  key={track.fileId}
                  onClick={() => handlePlayTrack(track, index)}
                  className={`w-full flex items-center gap-4 p-4 transition-colors touch-manipulation text-left cursor-pointer ${
                    isCurrentTrack ? 'bg-emerald-500/10' : 'hover:bg-slate-800'
                  }`}
                >
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
                  <div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center flex-shrink-0 relative">
                    <Music className={`w-5 h-5 ${isCurrentTrack ? 'text-emerald-400' : 'text-slate-400'}`} />
                    {isCached && (
                      <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                        <Check className="w-2.5 h-2.5 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm truncate ${isCurrentTrack ? 'text-emerald-400' : 'text-white'}`}>
                      {track.title || track.fileName}
                    </p>
                    <p className="text-xs text-slate-400 truncate">
                      {track.artist || track.channelName}
                      {track.duration ? ` • ${formatDuration(track.duration)}` : ''}
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
  );
}
