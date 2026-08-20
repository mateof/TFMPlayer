import { useState, useEffect } from 'react';
import { X, Plus, Music, Check, CloudOff, ListMusic } from 'lucide-react';
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
  // One or many tracks; a multi-selection adds them all in order
  tracks: Track[];
  onClose: () => void;
  // Called after a successful add (used to leave selection mode)
  onAdded?: () => void;
}

export function PlaylistPicker({ tracks, onClose, onAdded }: PlaylistPickerProps) {
  const { addToast } = useUiStore();
  const [loading, setLoading] = useState(true);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [offlinePlaylistIds, setOfflinePlaylistIds] = useState<Set<string>>(new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creating, setCreating] = useState(false);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  const isMultiple = tracks.length > 1;
  const firstTrack = tracks[0];

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

  // Queue for download every track that isn't cached yet (offline playlists)
  const queueMissingDownloads = async (): Promise<number> => {
    let queued = 0;
    for (const track of tracks) {
      if (!(await cacheService.isTrackCached(track.fileId))) {
        await downloadManager.addToQueue(track);
        queued++;
      }
    }
    return queued;
  };

  const reportResult = async (
    playlistName: string,
    playlistId: string | null,
    result: { added: number; duplicates: number; failed: number }
  ) => {
    const parts: string[] = [];
    if (result.added > 0) {
      parts.push(`${result.added} track${result.added === 1 ? '' : 's'} added`);
    }
    if (result.duplicates > 0) parts.push(`${result.duplicates} already there`);
    if (result.failed > 0) parts.push(`${result.failed} failed`);

    // Offline playlists pull in the audio too
    if (result.added > 0 && playlistId && offlinePlaylistIds.has(playlistId)) {
      const queued = await queueMissingDownloads();
      if (queued > 0) parts.push(`${queued} queued for download`);
    }

    const summary = parts.length > 0 ? parts.join(', ') : 'Nothing to add';
    const tone = result.added > 0 ? 'success' : result.failed > 0 ? 'error' : 'info';
    addToast(`${playlistName}: ${summary}`, tone);
  };

  const handleAddToPlaylist = async (playlistId: string, playlistName: string) => {
    setAddingTo(playlistId);
    setProgress({ done: 0, total: tracks.length });
    try {
      const result = await playlistsApi.addTracks(playlistId, tracks, (done, total) =>
        setProgress({ done, total })
      );
      await reportResult(playlistName, playlistId, result);
      onAdded?.();
      onClose();
    } catch (error) {
      addToast('Failed to add tracks', 'error');
      console.error(error);
    } finally {
      setAddingTo(null);
      setProgress(null);
    }
  };

  const handleCreateAndAdd = async () => {
    if (!newPlaylistName.trim()) return;

    const name = newPlaylistName.trim();
    setCreating(true);
    setProgress({ done: 0, total: tracks.length });
    try {
      const newPlaylist = await playlistsApi.create({ name, description: '' });
      const result = await playlistsApi.addTracks(newPlaylist.id, tracks, (done, total) =>
        setProgress({ done, total })
      );
      await reportResult(name, null, result);
      onAdded?.();
      onClose();
    } catch (error) {
      addToast('Failed to create playlist', 'error');
      console.error(error);
    } finally {
      setCreating(false);
      setProgress(null);
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

        {/* What is being added */}
        <div className="p-4 bg-slate-700/50 flex items-center gap-3">
          <div className="w-10 h-10 bg-slate-600 rounded flex items-center justify-center">
            {isMultiple ? (
              <ListMusic className="w-5 h-5 text-emerald-400" />
            ) : (
              <Music className="w-5 h-5 text-slate-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            {isMultiple ? (
              <>
                <p className="text-sm text-white">{tracks.length} tracks selected</p>
                <p className="text-xs text-slate-400 truncate">
                  {firstTrack.title || firstTrack.fileName} and {tracks.length - 1} more
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-white truncate">
                  {firstTrack.title || firstTrack.fileName}
                </p>
                <p className="text-xs text-slate-400 truncate">
                  {firstTrack.artist || firstTrack.channelName}
                </p>
              </>
            )}
          </div>
        </div>

        {/* Progress while adding a large selection */}
        {progress && progress.total > 1 && (
          <div className="px-4 py-2 bg-slate-700/30">
            <div className="flex items-center justify-between text-xs text-emerald-400 mb-1">
              <span>Adding tracks...</span>
              <span className="tabular-nums">{progress.done}/{progress.total}</span>
            </div>
            <div className="h-1 bg-slate-600 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 transition-all"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

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
                      {creating
                        ? 'Creating...'
                        : isMultiple
                          ? `Create & Add ${tracks.length}`
                          : 'Create & Add'}
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
                      onClick={() => handleAddToPlaylist(playlist.id, playlist.name)}
                      disabled={addingTo !== null || creating}
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
