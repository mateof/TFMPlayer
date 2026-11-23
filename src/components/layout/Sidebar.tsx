import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  Radio, HardDrive, ListMusic, Download, Settings, Star, Loader2, AudioLines, Search, ListPlus
} from 'lucide-react';
import { useDownloadStore } from '@/services/download/DownloadManager';
import { useChannelRefreshStore } from '@/services/channelRefresh/ChannelRefreshService';
import { useFavoriteChannelsQuery, usePlaylistsQuery } from '@/hooks/queries';
import { ChannelAvatar } from '@/components/channels/ChannelAvatar';
import { addTracksToPlaylist } from '@/services/playlists/addToPlaylist';
import { isTrackDrag, readDragPayload, resolveDragPayload } from '@/utils/dragTracks';
import { queryKeys } from '@/services/query/queryClient';
import { useUiStore } from '@/stores/uiStore';
import type { Playlist } from '@/types/models';

const navItems = [
  { to: '/channels', icon: Radio, label: 'Channels' },
  { to: '/search', icon: Search, label: 'Search' },
  { to: '/local', icon: HardDrive, label: 'Local files' },
  { to: '/playlists', icon: ListMusic, label: 'Playlists' },
  { to: '/downloads', icon: Download, label: 'Downloads' },
  { to: '/settings', icon: Settings, label: 'Settings' }
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 ${
    isActive ? 'bg-slate-800 text-emerald-400' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
  }`;

/** Desktop navigation (replaces the bottom tab bar from the lg breakpoint). */
export function Sidebar() {
  const activeDownloads = useDownloadStore((s) => s.activeDownloads.size);
  const refreshJobs = useChannelRefreshStore((s) => s.jobs);
  const runningRefreshes = Object.values(refreshJobs).filter((j) => j.phase === 'running');
  const favorites = useFavoriteChannelsQuery().data ?? [];
  const playlists = usePlaylistsQuery().data ?? [];

  return (
    <aside className="flex flex-col h-full min-h-0 bg-slate-950 border-r border-slate-800" aria-label="Main navigation">
      <div className="flex items-center gap-2 px-5 h-14 shrink-0">
        <AudioLines className="w-6 h-6 text-emerald-400" aria-hidden />
        <span className="font-semibold text-white">TFM Player</span>
      </div>

      <nav className="px-3 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink key={to} to={to} className={linkClass}>
            <Icon className="w-5 h-5" aria-hidden />
            <span className="flex-1">{label}</span>
            {to === '/downloads' && activeDownloads > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-emerald-500 text-white text-xs tabular-nums" aria-label={`${activeDownloads} downloading`}>
                {activeDownloads}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {runningRefreshes.length > 0 && (
        <div className="mx-3 mt-4 p-3 rounded-lg bg-emerald-500/10 space-y-1.5" role="status">
          <p className="text-xs text-emerald-300 uppercase tracking-wide">Refreshing</p>
          {runningRefreshes.map((job) => (
            <NavLink
              key={job.channelId}
              to={`/channels/${job.channelId}`}
              className="flex items-center gap-2 text-sm text-slate-200 hover:text-white"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0" aria-hidden />
              <span className="truncate">{job.channelName}</span>
            </NavLink>
          ))}
        </div>
      )}

      <div className="flex-1 min-h-0 overflow-y-auto pb-3">
        <SectionTitle icon={<Star className="w-3.5 h-3.5" aria-hidden />} label="Favorites" />
        <div className="px-3 space-y-0.5">
          {favorites.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">Star a channel to pin it here.</p>
          ) : (
            favorites.map((ch) => (
              <NavLink key={ch.id} to={`/channels/${ch.id}`} className={linkClass}>
                <ChannelAvatar channelId={ch.id} name={ch.name} size="sm" />
                <span className="truncate">{ch.name}</span>
              </NavLink>
            ))
          )}
        </div>

        <SectionTitle icon={<ListMusic className="w-3.5 h-3.5" aria-hidden />} label="Playlists" />
        <div className="px-3 space-y-0.5">
          {playlists.length === 0 ? (
            <p className="px-3 py-2 text-xs text-slate-500">No playlists yet.</p>
          ) : (
            playlists.map((pl) => <PlaylistDropTarget key={pl.id} playlist={pl} />)
          )}
        </div>
      </div>
    </aside>
  );
}

function SectionTitle({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="mt-5 mb-1 px-5 flex items-center gap-2 text-xs text-slate-500 uppercase tracking-wide">
      {icon}
      {label}
    </div>
  );
}

/** A playlist link that also accepts tracks and folders dropped on it. */
function PlaylistDropTarget({ playlist }: { playlist: Playlist }) {
  const queryClient = useQueryClient();
  const addToast = useUiStore((s) => s.addToast);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    const items = readDragPayload(e);
    if (!items || busy) return;

    setBusy('Preparing...');
    try {
      const tracks = await resolveDragPayload(items, setBusy);
      if (tracks.length === 0) {
        addToast('No audio in what was dropped', 'info');
        return;
      }
      await addTracksToPlaylist(playlist.id, playlist.name, tracks, (done, total) =>
        setBusy(`${done}/${total}`)
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });
    } catch (error) {
      console.error('Drop on playlist failed:', error);
      addToast(`Could not add to "${playlist.name}"`, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <NavLink
      to={`/playlists/${playlist.id}`}
      className={(state) =>
        `${linkClass(state)} ${over ? 'ring-2 ring-emerald-400 bg-emerald-500/10' : ''}`
      }
      onDragEnter={(e) => {
        if (isTrackDrag(e)) setOver(true);
      }}
      onDragOver={(e) => {
        if (!isTrackDrag(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragLeave={() => setOver(false)}
      onDrop={handleDrop}
      title={`Drop tracks here to add them to "${playlist.name}"`}
    >
      {busy ? (
        <Loader2 className="w-4 h-4 shrink-0 animate-spin text-emerald-400" aria-hidden />
      ) : over ? (
        <ListPlus className="w-4 h-4 shrink-0 text-emerald-400" aria-hidden />
      ) : (
        <ListMusic className="w-4 h-4 shrink-0" aria-hidden />
      )}
      <span className="flex-1 truncate">{playlist.name}</span>
      <span className="text-xs text-slate-500 tabular-nums" aria-label={busy ?? `${playlist.trackCount} tracks`}>
        {busy ?? playlist.trackCount}
      </span>
    </NavLink>
  );
}
