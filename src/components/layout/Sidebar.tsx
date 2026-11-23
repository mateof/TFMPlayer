import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { Radio, HardDrive, ListMusic, Download, Settings, Star, Loader2, AudioLines } from 'lucide-react';
import { getApiCache } from '@/db/database';
import { useDownloadStore } from '@/services/download/DownloadManager';
import { useChannelRefreshStore } from '@/services/channelRefresh/ChannelRefreshService';
import type { Channel } from '@/types/models';

const navItems = [
  { to: '/channels', icon: Radio, label: 'Channels', end: false },
  { to: '/local', icon: HardDrive, label: 'Local files', end: false },
  { to: '/playlists', icon: ListMusic, label: 'Playlists', end: false },
  { to: '/downloads', icon: Download, label: 'Downloads', end: false },
  { to: '/settings', icon: Settings, label: 'Settings', end: false }
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
    isActive ? 'bg-slate-800 text-emerald-400' : 'text-slate-300 hover:bg-slate-800/60 hover:text-white'
  }`;

/** Desktop navigation (replaces the bottom tab bar from the lg breakpoint). */
export function Sidebar() {
  const location = useLocation();
  const [favorites, setFavorites] = useState<Channel[]>([]);
  const activeDownloads = useDownloadStore((s) => s.activeDownloads.size);
  const refreshJobs = useChannelRefreshStore((s) => s.jobs);
  const runningRefreshes = Object.values(refreshJobs).filter((j) => j.phase === 'running');

  // Favourites come from the channel list cache, kept fresh by ChannelsPage.
  // Re-read on navigation so toggling a favourite shows up without a reload.
  useEffect(() => {
    getApiCache<Channel[]>('channels:favorites')
      .then((list) => setFavorites(list ?? []))
      .catch(() => {});
  }, [location.pathname, location.search]);

  return (
    <aside className="flex flex-col h-full min-h-0 bg-slate-950 border-r border-slate-800">
      <div className="flex items-center gap-2 px-5 h-14 shrink-0">
        <AudioLines className="w-6 h-6 text-emerald-400" />
        <span className="font-semibold text-white">TFM Player</span>
      </div>

      <nav className="px-3 space-y-1">
        {navItems.map(({ to, icon: Icon, label, end }) => (
          <NavLink key={to} to={to} end={end} className={linkClass}>
            <Icon className="w-5 h-5" />
            <span className="flex-1">{label}</span>
            {to === '/downloads' && activeDownloads > 0 && (
              <span className="px-1.5 py-0.5 rounded-full bg-emerald-500 text-white text-xs tabular-nums">
                {activeDownloads}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {runningRefreshes.length > 0 && (
        <div className="mx-3 mt-4 p-3 rounded-lg bg-emerald-500/10 space-y-1.5">
          <p className="text-xs text-emerald-300 uppercase tracking-wide">Refreshing</p>
          {runningRefreshes.map((job) => (
            <NavLink
              key={job.channelId}
              to={`/channels/${job.channelId}`}
              className="flex items-center gap-2 text-sm text-slate-200 hover:text-white"
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0" />
              <span className="truncate">{job.channelName}</span>
            </NavLink>
          ))}
        </div>
      )}

      <div className="mt-5 px-5 flex items-center gap-2 text-xs text-slate-500 uppercase tracking-wide">
        <Star className="w-3.5 h-3.5" />
        Favorites
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-2 space-y-0.5">
        {favorites.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-500">Star a channel to pin it here.</p>
        ) : (
          favorites.map((ch) => (
            <NavLink key={ch.id} to={`/channels/${ch.id}`} className={linkClass}>
              <Radio className="w-4 h-4 shrink-0" />
              <span className="truncate">{ch.name}</span>
            </NavLink>
          ))
        )}
      </div>
    </aside>
  );
}
