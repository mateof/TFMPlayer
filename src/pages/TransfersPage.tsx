import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  ArrowDownToLine, ArrowUpFromLine, Ban, Eraser, Layers, Loader2, Pause, Play, RotateCcw, ServerCog, Trash2
} from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { LoadingScreen } from '@/components/common/Spinner';
import { useServerFeatures } from '@/hooks/useServerFeatures';
import { useUiStore } from '@/stores/uiStore';
import { getV1Api, isApiError, type TransferDto } from '@/services/api/v1';
import { groupTransfers, hasFinished, transferActions, type TransferAction, type TransferSection } from '@/services/files/transfers';
import { operationErrorMessage } from '@/hooks/useFileOperations';
import { t } from '@/i18n';

const POLL_MS = 2000;
const QUERY_KEY = ['transfers', 'snapshot'] as const;

const sectionInfo: Record<TransferSection, { label: string; icon: React.ReactNode }> = {
  downloads: { label: 'Downloads to the server', icon: <ArrowDownToLine className="w-4 h-4" aria-hidden /> },
  uploads: { label: 'Uploads to Telegram', icon: <ArrowUpFromLine className="w-4 h-4" aria-hidden /> },
  tasks: { label: 'Folder tasks', icon: <Layers className="w-4 h-4" aria-hidden /> }
};

const stateLabels: Record<string, string> = {
  Working: 'In progress',
  Pending: 'Queued',
  Paused: 'Paused',
  Completed: 'Completed',
  Canceled: 'Canceled',
  Error: 'Failed'
};

const stateTint: Record<string, string> = {
  Working: 'bg-emerald-500/15 text-emerald-300',
  Pending: 'bg-slate-600/40 text-slate-300',
  Paused: 'bg-amber-500/15 text-amber-300',
  Completed: 'bg-sky-500/15 text-sky-300',
  Canceled: 'bg-slate-600/40 text-slate-400',
  Error: 'bg-red-500/15 text-red-300'
};

type Row = { type: 'header'; section: TransferSection; count: number } | { type: 'item'; item: TransferDto };

/**
 * What the server is downloading from Telegram, uploading to it, and the
 * folder tasks behind them. Polls every 2 s while the screen is visible.
 */
export function TransfersPage() {
  const queryClient = useQueryClient();
  const addToast = useUiStore((s) => s.addToast);
  const { features } = useServerFeatures();
  const canRemove = features.has('transfers.remove');
  const [busyId, setBusyId] = useState<string | null>(null);

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async ({ signal }) => (await getV1Api()).transfers.snapshot(signal),
    // Polling stops by itself while the app is in the background
    refetchInterval: (q) => (isApiError(q.state.error) && q.state.error.isNotFound ? false : POLL_MS),
    refetchIntervalInBackground: false,
    retry: (count, error) => !(isApiError(error) && error.isNotFound) && count < 2
  });

  const groups = useMemo(() => groupTransfers(query.data), [query.data]);
  const rows = useMemo<Row[]>(
    () => groups.flatMap((g) => [{ type: 'header' as const, section: g.section, count: g.items.length }, ...g.items.map((item) => ({ type: 'item' as const, item }))]),
    [groups]
  );
  const summary = query.data?.summary;

  const listRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: (i) => (rows[i]?.type === 'header' ? 40 : 92),
    overscan: 8
  });

  const act = async (id: string, fn: () => Promise<unknown>) => {
    setBusyId(id);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    } catch (error) {
      addToast(operationErrorMessage(error), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const runAction = (item: TransferDto, action: TransferAction) =>
    act(item.id, async () => {
      const api = (await getV1Api()).transfers;
      if (action === 'pause') await api.pause(item.id);
      else if (action === 'resume' || action === 'retry') await api.retry(item.id);
      else if (action === 'cancel') await api.cancel(item.id);
      else if (action === 'remove') await api.remove(item.id);
    });

  const notFound = isApiError(query.error) && query.error.isNotFound;

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t('Server transfers')}
        subtitle={summary ? t('Down {down} · Up {up}', { down: summary.downloadSpeed, up: summary.uploadSpeed }) : undefined}
        showBack
        actions={
          summary && (
            <>
              <button
                onClick={() => act('global', async () => {
                  const api = (await getV1Api()).transfers;
                  if (summary.downloadsPaused) await api.resumeDownloads();
                  else await api.pauseDownloads();
                })}
                disabled={busyId === 'global'}
                className="p-2 text-slate-400 hover:text-white disabled:opacity-50"
                aria-label={summary.downloadsPaused ? t('Resume all downloads') : t('Pause all downloads')}
                title={summary.downloadsPaused ? t('Resume all downloads') : t('Pause all downloads')}
              >
                {summary.downloadsPaused ? <Play className="w-5 h-5" aria-hidden /> : <Pause className="w-5 h-5" aria-hidden />}
              </button>
              <button
                onClick={() => act('clear', async () => {
                  await (await getV1Api()).transfers.clear({ scope: 'all' });
                })}
                disabled={busyId === 'clear' || !hasFinished(groups)}
                className="p-2 text-slate-400 hover:text-white disabled:opacity-40"
                aria-label={t('Clear finished')}
                title={t('Clear finished')}
              >
                <Eraser className="w-5 h-5" aria-hidden />
              </button>
            </>
          )
        }
      />

      {summary && (
        <div className="grid grid-cols-3 gap-2 px-4 py-3 border-b border-slate-700 bg-slate-800/60 text-center" role="status" aria-live="polite">
          <Stat label={t('Downloading')} value={summary.activeDownloads} extra={summary.queuedDownloads ? t('+{count} queued', { count: summary.queuedDownloads }) : undefined} />
          <Stat label={t('Uploading')} value={summary.activeUploads} extra={summary.queuedUploads ? t('+{count} queued', { count: summary.queuedUploads }) : undefined} />
          <Stat label={t('Tasks')} value={summary.activeTasks} extra={summary.downloadsPaused ? t('Downloads paused') : undefined} />
        </div>
      )}

      <div ref={listRef} className="flex-1 overflow-y-auto">
        {query.isPending ? (
          <LoadingScreen message={t('Loading transfers...')} />
        ) : notFound ? (
          <Empty title={t('This server does not report transfers')} hint={t('Update TelegramFileManager to use this section.')} />
        ) : query.isError && !query.data ? (
          <Empty title={t('Could not load the transfers')} hint={t('Check the connection with the server.')} />
        ) : rows.length === 0 ? (
          <Empty title={t('Nothing is being transferred')} hint={t('Downloads to the server and uploads to Telegram appear here.')} />
        ) : (
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((v) => {
              const row = rows[v.index];
              return (
                <div
                  key={row.type === 'header' ? `h-${row.section}` : row.item.id}
                  data-index={v.index}
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${v.start}px)` }}
                >
                  {row.type === 'header' ? (
                    <h2 className="flex items-center gap-2 px-4 pt-4 pb-2 text-xs uppercase tracking-wide text-slate-400">
                      {sectionInfo[row.section].icon}
                      {t(sectionInfo[row.section].label)}
                      <span className="tabular-nums">({row.count})</span>
                    </h2>
                  ) : (
                    <TransferRow
                      item={row.item}
                      actions={transferActions(row.item, canRemove)}
                      busy={busyId === row.item.id}
                      onAction={(a) => runAction(row.item, a)}
                    />
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

function Stat({ label, value, extra }: { label: string; value: number; extra?: string }) {
  return (
    <div>
      <p className="text-lg font-semibold text-white tabular-nums">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
      {extra && <p className="text-[11px] text-slate-500">{extra}</p>}
    </div>
  );
}

function Empty({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="flex flex-col items-center py-12 px-6 text-center text-slate-400">
      <ServerCog className="w-12 h-12 mb-4 opacity-50" aria-hidden />
      <p>{title}</p>
      <p className="text-sm mt-2">{hint}</p>
    </div>
  );
}

const actionButtons: Record<TransferAction, { label: string; icon: React.ReactNode; danger?: boolean }> = {
  pause: { label: 'Pause', icon: <Pause className="w-4 h-4" aria-hidden /> },
  resume: { label: 'Resume', icon: <Play className="w-4 h-4" aria-hidden /> },
  retry: { label: 'Retry', icon: <RotateCcw className="w-4 h-4" aria-hidden /> },
  cancel: { label: 'Cancel', icon: <Ban className="w-4 h-4" aria-hidden />, danger: true },
  remove: { label: 'Remove from list', icon: <Trash2 className="w-4 h-4" aria-hidden /> }
};

const ACTION_ORDER: TransferAction[] = ['pause', 'resume', 'retry', 'cancel', 'remove'];

function TransferRow({ item, actions, busy, onAction }: {
  item: TransferDto;
  actions: Set<TransferAction>;
  busy: boolean;
  onAction: (action: TransferAction) => void;
}) {
  const progress = Math.max(0, Math.min(100, Math.round(item.progress ?? 0)));
  const isTask = item.kind === 'task';
  const detail = isTask && item.totalItems
    ? t('{done} of {total} files', { done: item.executedItems ?? 0, total: item.totalItems })
    : item.size
      ? `${item.transmittedText} / ${item.sizeText}`
      : '';

  return (
    <div className="px-4 py-3 border-b border-slate-700">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-white truncate" title={item.name}>{item.name}</p>
          <p className="text-xs text-slate-400 truncate">
            {[item.channelName, item.action !== 'Download' && item.action !== 'Upload' ? item.action : null, item.path]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <span className={`px-2 py-0.5 rounded-full text-[11px] whitespace-nowrap ${stateTint[item.state] ?? stateTint.Pending}`}>
          {item.isQueued && item.state === 'Pending' ? t('Queued') : t(stateLabels[item.state] ?? item.state)}
        </span>
      </div>

      <div className="mt-2 flex items-center gap-3">
        <div
          className="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progress}
          aria-label={t('Progress of {name}', { name: item.name })}
        >
          <div
            className={`h-full transition-[width] ${item.state === 'Error' ? 'bg-red-500' : item.state === 'Paused' ? 'bg-amber-500' : 'bg-emerald-500'}`}
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-xs text-slate-400 tabular-nums whitespace-nowrap">{progress}%{detail ? ` · ${detail}` : ''}</span>
      </div>

      {actions.size > 0 && (
        <div className="mt-2 flex flex-wrap gap-2 justify-end">
          {busy && <Loader2 className="w-4 h-4 mt-1.5 animate-spin text-slate-400" aria-label={t('Working...')} />}
          {ACTION_ORDER.filter((a) => actions.has(a)).map((a) => (
            <button
              key={a}
              onClick={() => onAction(a)}
              disabled={busy}
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs disabled:opacity-50 ${
                actionButtons[a].danger ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
              }`}
              aria-label={`${t(actionButtons[a].label)}: ${item.name}`}
            >
              {actionButtons[a].icon}
              {t(actionButtons[a].label)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
