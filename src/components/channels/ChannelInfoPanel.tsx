import type { ReactNode } from 'react';
import { Radio, RefreshCw, Loader2, Music, Film, FileText, Image, Folder, HardDrive, Crown, Star } from 'lucide-react';
import { describeRefreshResult, type RefreshJob } from '@/services/channelRefresh/ChannelRefreshService';
import { formatRelativeTime } from '@/utils/format';
import type { ChannelDetail, ChannelStats } from '@/types/models';

interface ChannelInfoPanelProps {
  channel: ChannelDetail | null;
  stats: ChannelStats | null;
  job?: RefreshJob;
  onRefresh: () => void;
  children?: ReactNode;
}

/** Desktop side panel of a channel: statistics, index refresh and filters. */
export function ChannelInfoPanel({ channel, stats, job, onRefresh, children }: ChannelInfoPanelProps) {
  const running = job?.phase === 'running' || (!job && stats?.isRefreshing);

  const counters = stats
    ? [
        { label: 'Audio', value: stats.audioCount, icon: <Music className="w-4 h-4" />, accent: 'text-emerald-400' },
        { label: 'Videos', value: stats.videoCount, icon: <Film className="w-4 h-4" />, accent: 'text-sky-400' },
        { label: 'Documents', value: stats.documentCount, icon: <FileText className="w-4 h-4" />, accent: 'text-amber-400' },
        { label: 'Photos', value: stats.photoCount, icon: <Image className="w-4 h-4" />, accent: 'text-pink-400' },
        { label: 'Folders', value: stats.folderCount, icon: <Folder className="w-4 h-4" />, accent: 'text-yellow-400' }
      ]
    : [];

  return (
    <div className="p-4 space-y-5">
      {/* Identity */}
      <div className="flex items-center gap-3">
        <div className="w-14 h-14 rounded-full bg-slate-700 flex items-center justify-center shrink-0">
          <Radio className="w-7 h-7 text-slate-400" />
        </div>
        <div className="min-w-0">
          <p className="text-white font-semibold leading-tight break-words">{channel?.name ?? stats?.name ?? 'Channel'}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1 text-xs text-slate-400">
            <span className="capitalize">{stats?.type ?? channel?.type ?? 'channel'}</span>
            {(stats?.isOwner ?? channel?.isOwner) && (
              <span className="inline-flex items-center gap-0.5 text-amber-300"><Crown className="w-3 h-3" />owner</span>
            )}
            {(stats?.isFavorite ?? channel?.isFavorite) && (
              <span className="inline-flex items-center gap-0.5 text-yellow-400"><Star className="w-3 h-3 fill-yellow-400" />favorite</span>
            )}
          </div>
        </div>
      </div>

      {/* Totals */}
      {stats ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm text-slate-300">
            <HardDrive className="w-4 h-4 text-slate-400" />
            <span className="tabular-nums">{stats.fileCount.toLocaleString()} files</span>
            <span className="text-slate-500">·</span>
            <span className="tabular-nums">{stats.totalSizeText}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {counters.map((c) => (
              <div key={c.label} className="rounded-lg bg-slate-800 px-3 py-2">
                <div className={`flex items-center gap-1.5 text-xs ${c.accent}`}>
                  {c.icon}
                  {c.label}
                </div>
                <p className="text-lg text-white tabular-nums">{c.value.toLocaleString()}</p>
              </div>
            ))}
          </div>
          {!stats.hasDatabase && (
            <p className="text-xs text-amber-300">This channel has no local index yet. Refresh it to build one.</p>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-500">Statistics unavailable (offline or older server).</p>
      )}

      {/* Refresh */}
      <div className="rounded-lg border border-slate-700 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <p className="flex-1 text-sm text-white">Index</p>
          <button
            onClick={onRefresh}
            disabled={!!running}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500 text-white text-xs font-medium hover:bg-emerald-600 disabled:opacity-60"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {running ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
        {running && (
          <p className="text-xs text-slate-400">
            Scanning Telegram{job ? `, started ${formatRelativeTime(new Date(job.startedAt))}` : ''}.
            The list reloads when it finishes.
          </p>
        )}
        {job && job.phase !== 'running' && (
          <p className={`text-xs ${job.phase === 'failed' ? 'text-red-400' : 'text-slate-400'}`}>
            Last refresh: {job.result ? describeRefreshResult(job.result) : job.error ?? 'finished'}
          </p>
        )}
        {stats?.canRefresh === false && (
          <p className="text-xs text-amber-300">Refreshing your own channels is disabled on the server.</p>
        )}
      </div>

      {children}
    </div>
  );
}
