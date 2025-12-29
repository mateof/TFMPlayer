import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ListMusic, ChevronRight, Trash2, CloudOff, Cloud, WifiOff } from 'lucide-react';
import { Header, HeaderAction } from '@/components/layout/Header';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { LoadingScreen } from '@/components/common/Spinner';
import { playlistsApi } from '@/services/api/playlists.api';
import { useUiStore } from '@/stores/uiStore';
import { getAllOfflinePlaylists, deleteOfflinePlaylist } from '@/db/database';
import type { Playlist } from '@/types/models';

interface PlaylistWithOfflineStatus extends Playlist {
  isOffline?: boolean;
}

export function PlaylistsPage() {
  const navigate = useNavigate();
  const { addToast } = useUiStore();

  const [loading, setLoading] = useState(true);
  const [playlists, setPlaylists] = useState<PlaylistWithOfflineStatus[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [creating, setCreating] = useState(false);
  const [isOfflineMode, setIsOfflineMode] = useState(false);

  useEffect(() => {
    loadPlaylists();
  }, []);

  const loadPlaylists = async () => {
    setLoading(true);

    // Get offline playlists first
    const offlinePlaylists = await getAllOfflinePlaylists();
    const offlineIds = new Set(offlinePlaylists.map(p => p.id));

    try {
      // Try to load from server
      const data = await playlistsApi.getAll();

      // Mark which playlists are available offline
      const playlistsWithStatus: PlaylistWithOfflineStatus[] = data.map(p => ({
        ...p,
        isOffline: offlineIds.has(p.id)
      }));

      setPlaylists(playlistsWithStatus);
      setIsOfflineMode(false);
    } catch (error) {
      console.error('Failed to load from server, using offline data:', error);

      // Server unavailable - use offline playlists
      if (offlinePlaylists.length > 0) {
        const offlineAsPlaylists: PlaylistWithOfflineStatus[] = offlinePlaylists.map(p => ({
          id: p.id,
          name: p.name,
          description: p.description,
          trackCount: p.trackCount,
          createdAt: p.savedAt.toISOString(),
          updatedAt: p.lastSyncedAt?.toISOString() || p.savedAt.toISOString(),
          isOffline: true
        }));
        setPlaylists(offlineAsPlaylists);
        setIsOfflineMode(true);
        addToast('Offline mode - showing cached playlists', 'info');
      } else {
        addToast('No connection and no offline playlists available', 'error');
        setPlaylists([]);
        setIsOfflineMode(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleCreatePlaylist = async () => {
    if (!newPlaylistName.trim()) {
      addToast('Please enter a playlist name', 'warning');
      return;
    }

    if (isOfflineMode) {
      addToast('Cannot create playlist while offline', 'error');
      return;
    }

    setCreating(true);
    try {
      await playlistsApi.create({ name: newPlaylistName.trim() });
      setNewPlaylistName('');
      setShowCreate(false);
      addToast('Playlist created!', 'success');
      loadPlaylists();
    } catch {
      addToast('Failed to create playlist', 'error');
    } finally {
      setCreating(false);
    }
  };

  const handleDeletePlaylist = async (playlist: PlaylistWithOfflineStatus, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Delete "${playlist.name}"?`)) return;

    try {
      if (!isOfflineMode) {
        await playlistsApi.delete(playlist.id);
      }
      // Also delete offline version
      await deleteOfflinePlaylist(playlist.id);
      addToast('Playlist deleted', 'success');
      loadPlaylists();
    } catch {
      addToast('Failed to delete playlist', 'error');
    }
  };

  return (
    <div className="flex flex-col min-h-screen">
      <Header
        title="Playlists"
        actions={
          <HeaderAction
            icon={<Plus className="w-5 h-5" />}
            onClick={() => setShowCreate(true)}
            label="Create playlist"
          />
        }
      />

      {/* Offline mode indicator */}
      {isOfflineMode && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 text-amber-400 text-sm">
          <WifiOff className="w-4 h-4" />
          <span>Offline mode - showing cached playlists</span>
        </div>
      )}

      {/* Create playlist form */}
      {showCreate && (
        <div className="p-4 bg-slate-800 border-b border-slate-700">
          <div className="flex gap-3">
            <Input
              placeholder="Playlist name"
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreatePlaylist()}
              className="flex-1"
            />
            <Button
              variant="primary"
              onClick={handleCreatePlaylist}
              loading={creating}
              disabled={isOfflineMode}
            >
              Create
            </Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingScreen message="Loading playlists..." />
        ) : playlists.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <ListMusic className="w-12 h-12 mb-4 opacity-50" />
            <p className="mb-4">{isOfflineMode ? 'No offline playlists' : 'No playlists yet'}</p>
            {!isOfflineMode && (
              <Button
                variant="primary"
                icon={<Plus className="w-4 h-4" />}
                onClick={() => setShowCreate(true)}
              >
                Create Playlist
              </Button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-700">
            {playlists.map((playlist) => (
              <div
                key={playlist.id}
                onClick={() => navigate(`/playlists/${playlist.id}`)}
                className="w-full flex items-center gap-4 p-4 hover:bg-slate-800 transition-colors touch-manipulation text-left cursor-pointer"
              >
                <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-cyan-500 rounded-lg flex items-center justify-center flex-shrink-0 relative">
                  <ListMusic className="w-6 h-6 text-white" />
                  {/* Offline indicator badge */}
                  {playlist.isOffline && (
                    <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center border-2 border-slate-900">
                      <CloudOff className="w-3 h-3 text-white" />
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-white truncate">{playlist.name}</p>
                    {playlist.isOffline && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">
                        OFFLINE
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-400">
                    {playlist.trackCount} tracks
                  </p>
                </div>
                <button
                  onClick={(e) => handleDeletePlaylist(playlist, e)}
                  className="p-2 text-slate-500 hover:text-red-400 transition-colors touch-manipulation"
                >
                  <Trash2 className="w-5 h-5" />
                </button>
                <ChevronRight className="w-5 h-5 text-slate-500" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
