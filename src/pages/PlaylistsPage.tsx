import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, ListMusic, ChevronRight, Trash2, CloudOff, WifiOff, RefreshCw, Sparkles, History } from 'lucide-react';
import { Header, HeaderAction } from '@/components/layout/Header';
import { Button } from '@/components/common/Button';
import { Input } from '@/components/common/Input';
import { LoadingScreen } from '@/components/common/Spinner';
import { confirmDialog } from '@/components/common/confirm';
import { SmartPlaylistEditor } from '@/components/playlists/SmartPlaylistEditor';
import { playlistsApi } from '@/services/api/playlists.api';
import { smartPlaylists } from '@/services/playlists/smartPlaylists';
import { queryKeys } from '@/services/query/queryClient';
import { usePlaylistsQuery } from '@/hooks/queries';
import { useUiStore } from '@/stores/uiStore';
import { getAllOfflinePlaylists, deleteOfflinePlaylist, getCachedPlaylists, deleteCachedPlaylist } from '@/db/database';
import { t } from '@/i18n';
import type { Playlist } from '@/types/models';

interface PlaylistRow extends Playlist {
  isOffline: boolean;
}

/**
 * Server playlists (react-query, persisted: instant and offline) merged with
 * the ones saved for offline, plus the smart playlists kept on the device.
 */
export function PlaylistsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useUiStore((s) => s.addToast);
  const [showCreate, setShowCreate] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [editingSmart, setEditingSmart] = useState(false);

  const serverQuery = usePlaylistsQuery();
  const offlineQuery = useQuery({ queryKey: ['offline-playlists'], queryFn: getAllOfflinePlaylists, staleTime: 0 });
  // Lists cached by versions before react-query: only used if nothing else exists
  const legacyQuery = useQuery({ queryKey: ['legacy-cached-playlists'], queryFn: getCachedPlaylists, staleTime: Infinity });
  const smartQuery = useQuery({ queryKey: ['smart', 'list'], queryFn: smartPlaylists.list, staleTime: 0 });

  const isOfflineMode = serverQuery.isError;
  const syncing = serverQuery.isFetching;

  const playlists = useMemo<PlaylistRow[]>(() => {
    const offline = offlineQuery.data ?? [];
    const offlineIds = new Set(offline.map((p) => p.id));
    const byId = new Map<string, PlaylistRow>();
    for (const p of offline) {
      byId.set(p.id, {
        id: p.id,
        name: p.name,
        description: p.description,
        trackCount: p.trackCount,
        dateCreated: p.savedAt.toISOString(),
        dateModified: (p.lastSyncedAt ?? p.savedAt).toISOString(),
        isOffline: true
      });
    }
    const server = serverQuery.data ?? (legacyQuery.data as Playlist[] | undefined) ?? [];
    for (const p of server) byId.set(p.id, { ...p, isOffline: offlineIds.has(p.id) });
    return [...byId.values()];
  }, [serverQuery.data, offlineQuery.data, legacyQuery.data]);

  const loading = serverQuery.isPending && offlineQuery.isPending;

  const createMutation = useMutation({
    mutationFn: (name: string) => playlistsApi.create({ name }),
    onSuccess: () => {
      setNewPlaylistName('');
      setShowCreate(false);
      addToast(t('Playlist created'), 'success');
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    },
    onError: () => addToast(t('Failed to create playlist'), 'error')
  });

  const handleCreatePlaylist = () => {
    const name = newPlaylistName.trim();
    if (!name) {
      addToast(t('Please enter a playlist name'), 'warning');
      return;
    }
    if (isOfflineMode) {
      addToast(t('Cannot create playlist while offline'), 'error');
      return;
    }
    createMutation.mutate(name);
  };

  const handleDeletePlaylist = async (playlist: PlaylistRow, e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await confirmDialog({
      title: t('Delete playlist?'),
      message: t('"{name}" will be deleted from the server. Its tracks are not affected.', { name: playlist.name }),
      confirmLabel: t('Delete'),
      danger: true
    });
    if (!ok) return;
    try {
      if (!isOfflineMode) await playlistsApi.delete(playlist.id);
      await deleteOfflinePlaylist(playlist.id);
      await deleteCachedPlaylist(playlist.id);
      queryClient.setQueryData<Playlist[]>(queryKeys.playlists.all, (prev) => prev?.filter((p) => p.id !== playlist.id));
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
      queryClient.invalidateQueries({ queryKey: ['offline-playlists'] });
      addToast(t('Playlist deleted'), 'success');
    } catch {
      addToast(t('Failed to delete playlist'), 'error');
    }
  };

  const smart = smartQuery.data ?? [];

  return (
    <div className="flex flex-col min-h-full">
      <Header
        title={t('Playlists')}
        actions={
          <>
            <HeaderAction
              icon={<RefreshCw className={`w-5 h-5 ${syncing ? 'animate-spin' : ''}`} aria-hidden />}
              onClick={() => serverQuery.refetch()}
              label={t('Refresh')}
              disabled={syncing}
            />
            <HeaderAction icon={<Sparkles className="w-5 h-5" aria-hidden />} onClick={() => setEditingSmart(true)} label={t('New smart playlist')} />
            <HeaderAction icon={<Plus className="w-5 h-5" aria-hidden />} onClick={() => setShowCreate(true)} label={t('Create playlist')} />
          </>
        }
      />

      {isOfflineMode && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/20 text-amber-400 text-sm" role="status">
          <WifiOff className="w-4 h-4" aria-hidden />
          <span>{t('Offline mode - showing cached playlists')}</span>
        </div>
      )}

      {showCreate && (
        <div className="p-4 bg-slate-800 border-b border-slate-700">
          <div className="flex gap-3 max-w-2xl">
            <Input
              placeholder={t('Playlist name')}
              aria-label={t('Playlist name')}
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreatePlaylist()}
              className="flex-1"
              autoFocus
            />
            <Button variant="primary" onClick={handleCreatePlaylist} loading={createMutation.isPending} disabled={isOfflineMode}>
              {t('Create')}
            </Button>
            <Button variant="ghost" onClick={() => setShowCreate(false)}>
              {t('Cancel')}
            </Button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto pb-6">
        {/* History shortcut (the sidebar has it on desktop) */}
        <div className="px-4 pt-4 lg:hidden">
          <button
            onClick={() => navigate('/history')}
            className="w-full flex items-center gap-3 p-3 rounded-xl bg-slate-800/70 hover:bg-slate-800 text-left"
          >
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-sky-500 to-indigo-500 flex items-center justify-center shrink-0" aria-hidden>
              <History className="w-5 h-5 text-white" />
            </div>
            <span className="flex-1 text-sm text-white">{t('Recently played and most played')}</span>
            <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden />
          </button>
        </div>

        {/* Smart playlists */}
        <section aria-labelledby="smart-heading" className="px-4 pt-4">
          <div className="flex items-center gap-2 mb-2">
            <h2 id="smart-heading" className="text-xs uppercase tracking-wide text-slate-400 flex-1">{t('Smart playlists')}</h2>
            <button onClick={() => setEditingSmart(true)} className="text-xs text-emerald-400 hover:underline">
              {t('New')}
            </button>
          </div>
          {smart.length === 0 ? (
            <button
              onClick={() => setEditingSmart(true)}
              className="w-full flex items-center gap-3 p-3 rounded-xl border border-dashed border-slate-700 text-left hover:bg-slate-800/60"
            >
              <Sparkles className="w-5 h-5 text-amber-300" aria-hidden />
              <span className="text-sm text-slate-300">
                {t('Build playlists from rules, e.g. every FLAC of a channel added this month.')}
              </span>
            </button>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
              {smart.map((sp) => (
                <button
                  key={sp.id}
                  onClick={() => navigate(`/smart/${sp.id}`)}
                  className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/70 hover:bg-slate-800 text-left"
                >
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-400 to-pink-500 flex items-center justify-center shrink-0" aria-hidden>
                    <Sparkles className="w-5 h-5 text-white" />
                  </div>
                  <span className="flex-1 min-w-0 text-sm text-white truncate">{sp.name}</span>
                  <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden />
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Server playlists */}
        <section aria-labelledby="playlists-heading" className="pt-6">
          <h2 id="playlists-heading" className="px-4 mb-2 text-xs uppercase tracking-wide text-slate-400">{t('Playlists')}</h2>
          {loading ? (
            <LoadingScreen message={t('Loading playlists...')} />
          ) : playlists.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400">
              <ListMusic className="w-12 h-12 mb-4 opacity-50" aria-hidden />
              <p className="mb-4">{isOfflineMode ? t('No offline playlists') : t('No playlists yet')}</p>
              {!isOfflineMode && (
                <Button variant="primary" icon={<Plus className="w-4 h-4" />} onClick={() => setShowCreate(true)}>
                  {t('Create playlist')}
                </Button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-slate-800 lg:divide-y-0 lg:grid lg:grid-cols-2 2xl:grid-cols-3 lg:gap-3 lg:px-4">
              {playlists.map((playlist) => (
                <div
                  key={playlist.id}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(`/playlists/${playlist.id}`)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/playlists/${playlist.id}`);
                  }}
                  className="group w-full flex items-center gap-4 p-4 hover:bg-slate-800 transition-colors touch-manipulation text-left cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 lg:rounded-xl lg:bg-slate-800/50 lg:border lg:border-slate-700/60"
                >
                  <div className="w-12 h-12 bg-gradient-to-br from-emerald-500 to-cyan-500 rounded-lg flex items-center justify-center flex-shrink-0 relative" aria-hidden>
                    <ListMusic className="w-6 h-6 text-white" />
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
                        <span className="text-[10px] px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded uppercase">
                          {t('Offline')}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-400">{t('{count} tracks', { count: playlist.trackCount })}</p>
                  </div>
                  <button
                    onClick={(e) => handleDeletePlaylist(playlist, e)}
                    className="p-2 text-slate-500 hover:text-red-400 transition-colors touch-manipulation lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100"
                    aria-label={t('Delete {name}', { name: playlist.name })}
                    title={t('Delete')}
                  >
                    <Trash2 className="w-5 h-5" aria-hidden />
                  </button>
                  <ChevronRight className="w-5 h-5 text-slate-500" aria-hidden />
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {editingSmart && (
        <SmartPlaylistEditor
          onClose={() => setEditingSmart(false)}
          onSave={async (name, rules) => {
            const created = await smartPlaylists.save({ name, rules });
            queryClient.invalidateQueries({ queryKey: ['smart'] });
            navigate(`/smart/${created.id}`);
          }}
        />
      )}
    </div>
  );
}
