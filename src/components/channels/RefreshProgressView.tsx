import { useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { channelRefreshService, type RefreshJob } from '@/services/channelRefresh/ChannelRefreshService';
import { useUiStore } from '@/stores/uiStore';
import { t } from '@/i18n';

const TYPE_LABELS: Record<string, string> = {
  documents: 'Documents',
  audio: 'Audio',
  video: 'Videos',
  photos: 'Photos'
};

/**
 * Live progress of a channel refresh (per media type while searching
 * Telegram, then the indexing count) with a cancel button. Servers without
 * progress reporting just get the spinner line.
 */
export function RefreshProgressView({ job, compact = false }: { job: RefreshJob; compact?: boolean }) {
  const addToast = useUiStore((s) => s.addToast);
  const [cancelling, setCancelling] = useState(false);
  const progress = job.progress;
  const stopping = cancelling || job.cancelRequested || progress?.cancelRequested;

  const cancel = async () => {
    setCancelling(true);
    try {
      await channelRefreshService.cancel(job.channelId);
    } catch {
      addToast(t('Could not cancel the refresh'), 'error');
      setCancelling(false);
    }
  };

  const phaseLabel = stopping
    ? t('Stopping...')
    : progress?.phase === 'indexing'
      ? t('Indexing {count} new files...', { count: progress.newFiles })
      : t('Searching Telegram...');

  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400 shrink-0" aria-hidden />
        <p className="flex-1 text-xs text-emerald-300">{phaseLabel}</p>
        {progress !== undefined && (
          <button
            onClick={cancel}
            disabled={!!stopping}
            className="flex items-center gap-1 px-2 py-1 rounded-md text-xs text-slate-300 bg-slate-700/70 hover:bg-slate-700 disabled:opacity-50"
          >
            <X className="w-3.5 h-3.5" aria-hidden />
            {t('Cancel')}
          </button>
        )}
      </div>

      {progress && !compact && (
        <div className="space-y-1.5">
          {progress.filters.map((f) => {
            const percent = f.done ? 100 : f.total ? Math.min(100, (f.fetched / f.total) * 100) : null;
            return (
              <div key={f.type}>
                <div className="flex justify-between text-[11px] text-slate-400">
                  <span>{t(TYPE_LABELS[f.type] ?? f.type)}</span>
                  <span className="tabular-nums">
                    {f.done ? t('Done') : f.total ? `${f.fetched.toLocaleString()} / ${f.total.toLocaleString()}` : f.fetched.toLocaleString()}
                  </span>
                </div>
                <div className="h-1 rounded-full bg-slate-700 overflow-hidden">
                  <div
                    className={`h-full rounded-full bg-emerald-500 transition-[width] duration-500 ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
                    style={percent !== null ? { width: `${Math.max(percent, 2)}%` } : undefined}
                  />
                </div>
              </div>
            );
          })}
          {progress.phase === 'indexing' && progress.newFiles > 0 && (
            <div>
              <div className="flex justify-between text-[11px] text-slate-400">
                <span>{t('Indexed')}</span>
                <span className="tabular-nums">{progress.indexed.toLocaleString()} / {progress.newFiles.toLocaleString()}</span>
              </div>
              <div className="h-1 rounded-full bg-slate-700 overflow-hidden">
                <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-500" style={{ width: `${Math.max(2, (progress.indexed / progress.newFiles) * 100)}%` }} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
