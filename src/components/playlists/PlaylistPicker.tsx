import { useState, useEffect } from 'react';
import { isAxiosError } from 'axios';
import { X, Plus, Music, Check, CloudOff } from 'lucide-react';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { Spinner } from '@/components/common/Spinner';
import { playlistsApi } from '@/services/api/playlists.api';
import { useUiStore } from '@/stores/uiStore';
import { isPlaylistOffline } from '@/db/database';
import { downloadManager } from '@/services/download/DownloadManager';
import { cacheService } from '@/services/cache/CacheService';
import type { Track, Playlist } from '@/types/models';

interface PlaylistPickerProps {
  track: Track;
  onClose: () => void;
}

export function PlaylistPicker({ track, onClose }: PlaylistPickerProps) {
  const { addToast } = useUiStore();
  const [loading, setLoading] = useState(true);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [offlinePlaylistIds, setOfflinePlaylistIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);

  useEffect(() => {
    loadPlaylists();
  }, []);

  const loadPlaylists = async () => {
    setLoading(true);
    try {
      const data = await playlistsApi.getAll();
      setPlaylists(data);

      // Check which playlists are offline
      const offlineIds = new Set<string>();
      for (const playlist of data) {
        const isOffline = await isPlaylistOffline(playlist.id);
        if (isOffline) offlineIds.add(playlist.id);
      }
      setOfflinePlaylistIds(offlineIds);
    } catch (error) {
      addToast('Failed to load playlists', 'error');
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToPlaylist = async (playlistId: string) => {
    setAddingTo(playlistId);
    try {
      await playlistsApi.addTrack(playlistId, track);

      // If playlist is offline, auto-download the track
      if (offlinePlaylistIds.has(playlistId)) {
        const isCached = await cacheService.isTrackCached(track.fileId);
        if (!isCached) {
          await downloadManager.addToQueue(track);
          addToast('Track added and queued for download', 'success');
        } else {
          addToast('Track added to offline playlist', 'success');
        }
      } else {
        addToast('Track added to playlist', 'success');
      }
      onClose();
    } catch (error) {
      // Server returns 409 Conflict when the track is already in the playlist
      if (isAxiosError(error) && error.response?.status === 409) {
        addToast('This track is already in that playlist', 'info');
      } else {
        addToast('Failed to add track', 'error');
        console.error(error);
      }
    } finally {
      setAddingTo(null);
    }
  };

  const handleCreateAndAdd = async () => {
    if (!newPlaylistName.trim()) return;

    setCreating(true);
    try {
      const newPlaylist = await playlistsApi.create({
        name: newPlaylistName.trim(),
        description: ''
      });
      await playlistsApi.addTrack(newPlaylist.id, track);
      addToast(`Added to "${newPlaylistName}"`, 'success');
      onClose();
    } catch (error) {
      addToast('Failed to create playlist', 'error');
      console.error(error);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md bg-slate-800 rounded-t-2xl sm:rounded-2xl max-h-[80vh] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="text-lg font-bold text-white">Add to Playlist</h2>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Track info */}
        <div className="p-4 bg-slate-700/50 flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-600 rounded flex items-center justify-center">
            <Music className="w-5 h-5 text-slate-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">
              {track.title || track.fileName}
            </p>
            <p className="text-xs text-slate-400 truncate">
              {track.artist || track.channelName}
            </p>
          </div>
        </div>

        {/* Content */}
        <div className="max-h-[40vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          ) : (
            <div className="p-2">
              {/* Create new playlist */}
              {showCreate ? (
                <div className="p-3 bg-slate-700/50 rounded-lg mb-2">
                  <Input
                    placeholder="Playlist name"
                    value={newPlaylistName}
                    onChange={(e) => setNewPlaylistName(e.target.value)}
                    autoFocus
                  />
                  <div className="flex gap-2 mt-3">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setShowCreate(false)}
                      disabled={creating}
                    >
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={handleCreateAndAdd}
                      disabled={creating || !newPlaylistName.trim()}
                      className="flex-1"
                    >
                      {creating ? 'Creating...' : 'Create & Add'}
                    </Button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowCreate(true)}
                  className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-slate-700 transition-colors text-left"
                >
                  <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
                    <Plus className="w-5 h-5 text-emerald-400" />
                  </div>
                  <span className="text-emerald-400 font-medium">Create New Playlist</span>
                </button>
              )}

              {/* Playlist list */}
              {playlists.length === 0 && !showCreate ? (
                <p className="text-center text-slate-400 py-4">
                  No playlists yet
                </p>
              ) : (
                playlists.map((playlist) => {
                  const isOffline = offlinePlaylistIds.has(playlist.id);
                  return (
                    <button
                      key={playlist.id}
                      onClick={() => handleAddToPlaylist(playlist.id)}
                      disabled={addingTo !== null}
                      className="w-full flex items-center gap-3 p-3 rounded-lg hover:bg-slate-700 transition-colors text-left disabled:opacity-50"
                    >
                      <div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center relative">
                        <Music className="w-5 h-5 text-slate-400" />
                        {isOffline && (
                          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                            <CloudOff className="w-2.5 h-2.5 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{playlist.name}</p>
                        <p className="text-xs text-slate-400">
                          {playlist.trackCount} tracks{isOffline && ' • Offline'}
                        </p>
                      </div>
                      {addingTo === playlist.id ? (
                        <Spinner size="sm" />
                      ) : (
                        <Check className="w-5 h-5 text-slate-500" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Safe area for mobile */}
        <div className="h-safe-area-bottom bg-slate-800" />
      </div>
    </div>
  );
}
