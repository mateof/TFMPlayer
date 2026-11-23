import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { HardDrive, Trash2, ShieldCheck, Sparkles, Loader2 } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { LoadingScreen } from '@/components/common/Spinner';
import { confirmDialog } from '@/components/common/confirm';
import { ChannelAvatar } from '@/components/channels/ChannelAvatar';
import { storageService } from '@/services/storage/StorageService';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';
import { formatFileSize } from '@/utils/format';
import { t } from '@/i18n';

const CLEAN_OPTIONS = [30, 60, 90, 180, 365];

/** What the downloads use on this device, per channel, and how to free space. */
export function StoragePage() {
  const queryClient = useQueryClient();
  const addToast = useUiStore((s) => s.addToast);
  const autoCleanDays = useSettingsStore((s) => s.autoCleanDays);
  const setAutoCleanDays = useSettingsStore((s) => s.setAutoCleanDays);
  const [cleanDays, setCleanDays] = useState(autoCleanDays || 90);
  const [busy, setBusy] = useState<string | null>(null);

  const query = useQuery({ queryKey: ['storage-report'], queryFn: () => storageService.report(), staleTime: 0 });
  const report = query.data;

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['storage-report'] });

  const deleteGroup = async (key: string, label: string, protectedCount: number) => {
    const ok = await confirmDialog({
      title: t('Delete the downloads of {name}?', { name: label }),
      message: protectedCount > 0
        ? t('{count} track(s) of playlists kept offline are kept.', { count: protectedCount })
        : t('They can be downloaded again at any time.'),
      confirmLabel: t('Delete'),
      danger: true
    });
    if (!ok) return;
    setBusy(key);
    try {
      const removed = await storageService.deleteGroup(key);
      addToast(t('{count} track(s) deleted', { count: removed }), 'success');
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const cleanNow = async () => {
    const ok = await confirmDialog({
      title: t('Free up space?'),
      message: t('Tracks not played in {days} days are deleted, except those of playlists kept offline.', { days: cleanDays }),
      confirmLabel: t('Clean'),
      danger: true
    });
    if (!ok) return;
    setBusy('clean');
    try {
      const { count, bytes } = await storageService.cleanNotPlayedSince(cleanDays);
      addToast(count > 0 ? t('{count} track(s) deleted, {size} freed', { count, size: formatFileSize(bytes) }) : t('Nothing to clean'), 'success');
      refresh();
    } finally {
      setBusy(null);
    }
  };

  const usedPercent = report?.usage != null && report.quota ? Math.min(100, (report.usage / report.quota) * 100) : null;

  return (
    <div className="flex flex-col min-h-screen lg:min-h-0">
      <Header title={t('Storage')} subtitle={t('Downloads on this device')} showBack backPath="/downloads" />

      {query.isPending || !report ? (
        <LoadingScreen message={t('Loading...')} />
      ) : (
        <div className="p-4 space-y-6 max-w-3xl w-full mx-auto">
          {/* Usage */}
          <section className="rounded-2xl bg-slate-800/70 p-4" aria-labelledby="usage-heading">
            <div className="flex items-center gap-3">
              <HardDrive className="w-6 h-6 text-emerald-400" aria-hidden />
              <div className="flex-1">
                <h2 id="usage-heading" className="text-white font-semibold">
                  {t('{count} tracks · {size}', { count: report.trackCount, size: formatFileSize(report.trackBytes) })}
                </h2>
                {report.usage != null && report.quota != null && (
                  <p className="text-xs text-slate-400">
                    {t('{used} used of {quota} available to the app', { used: formatFileSize(report.usage), quota: formatFileSize(report.quota) })}
                  </p>
                )}
              </div>
            </div>
            {usedPercent != null && (
              <div
                className="mt-3 h-2 rounded-full bg-slate-700 overflow-hidden"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(usedPercent)}
                aria-label={t('Storage used')}
              >
                <div
                  className={`h-full rounded-full ${usedPercent > 85 ? 'bg-red-500' : usedPercent > 60 ? 'bg-amber-400' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.max(usedPercent, 1)}%` }}
                />
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
              <span className="flex items-center gap-1">
                <ShieldCheck className={`w-3.5 h-3.5 ${report.persisted ? 'text-emerald-400' : 'text-amber-400'}`} aria-hidden />
                {report.persisted ? t('Protected from automatic browser cleanup') : t('The browser may delete downloads if space runs low')}
              </span>
              <span>{t('{count} offline playlist(s), {tracks} tracks protected', { count: report.offlinePlaylistCount, tracks: report.protectedCount })}</span>
            </div>
          </section>

          {/* Clean */}
          <section className="rounded-2xl bg-slate-800/70 p-4 space-y-3" aria-labelledby="clean-heading">
            <h2 id="clean-heading" className="flex items-center gap-2 text-white font-semibold">
              <Sparkles className="w-5 h-5 text-amber-300" aria-hidden />
              {t('Free up space')}
            </h2>
            <p className="text-sm text-slate-400">{t('Delete what has not been played for a while. Playlists kept offline are never touched.')}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-slate-300">{t('Not played in')}</span>
              {CLEAN_OPTIONS.map((d) => (
                <button
                  key={d}
                  onClick={() => setCleanDays(d)}
                  aria-pressed={cleanDays === d}
                  className={`px-3 py-1 rounded-full text-sm ${cleanDays === d ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
                >
                  {t('{count} days', { count: d })}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={cleanNow}
                disabled={busy !== null}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/90 hover:bg-red-500 text-white text-sm font-medium disabled:opacity-50"
              >
                {busy === 'clean' ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden /> : <Trash2 className="w-4 h-4" aria-hidden />}
                {t('Clean now')}
              </button>
              <label className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-900 text-sm text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  className="w-4 h-4 accent-emerald-500"
                  checked={autoCleanDays > 0}
                  onChange={(e) => setAutoCleanDays(e.target.checked ? cleanDays : 0)}
                />
                {autoCleanDays > 0
                  ? t('Automatically at startup ({count} days)', { count: autoCleanDays })
                  : t('Do it automatically at startup')}
              </label>
            </div>
          </section>

          {/* Per source */}
          <section aria-labelledby="groups-heading">
            <h2 id="groups-heading" className="mb-2 text-xs uppercase tracking-wide text-slate-400">{t('By source')}</h2>
            {report.groups.length === 0 ? (
              <p className="py-8 text-center text-slate-400">{t('Nothing downloaded yet.')}</p>
            ) : (
              <ul className="space-y-2">
                {report.groups.map((g) => {
                  const share = report.trackBytes > 0 ? (g.bytes / report.trackBytes) * 100 : 0;
                  return (
                    <li key={g.key} className="flex items-center gap-3 p-3 rounded-xl bg-slate-800/50">
                      {g.key === 'local' ? (
                        <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center" aria-hidden>
                          <HardDrive className="w-4 h-4 text-slate-300" />
                        </div>
                      ) : (
                        <ChannelAvatar channelId={g.key} name={g.label} size="sm" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate">{g.key === 'local' ? t('Local files') : g.label}</p>
                        <p className="text-xs text-slate-400">
                          {t('{count} tracks', { count: g.count })} · {formatFileSize(g.bytes)}
                          {g.protectedCount > 0 && ` · ${t('{count} protected', { count: g.protectedCount })}`}
                        </p>
                        <div className="mt-1.5 h-1 rounded-full bg-slate-700 overflow-hidden" aria-hidden>
                          <div className="h-full bg-emerald-500/70" style={{ width: `${Math.max(share, 1)}%` }} />
                        </div>
                      </div>
                      <button
                        onClick={() => deleteGroup(g.key, g.key === 'local' ? t('Local files') : g.label, g.protectedCount)}
                        disabled={busy !== null || g.count === g.protectedCount}
                        className="p-2 text-slate-400 hover:text-red-400 disabled:opacity-40"
                        aria-label={t('Delete the downloads of {name}', { name: g.label })}
                        title={t('Delete')}
                      >
                        {busy === g.key ? <Loader2 className="w-5 h-5 animate-spin" aria-hidden /> : <Trash2 className="w-5 h-5" aria-hidden />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
