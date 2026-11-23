import { create } from 'zustand';
import { channelsApi } from '@/services/api/channels.api';
import { useUiStore } from '@/stores/uiStore';
import { serverCapabilities } from '@/services/server/capabilities';
import type { ChannelRefreshOptions, ChannelRefreshProgress, ChannelRefreshResult } from '@/types/models';
import { t } from '@/i18n';

/**
 * Tracks channel index refreshes running on TelegramFileManager.
 *
 * The scan is fire-and-forget on the server (POST answers 202 and the work
 * starts afterwards), so the state lives here, outside any page: it keeps
 * polling while the user navigates and reports the outcome with a toast.
 */

export type RefreshPhase = 'running' | 'done' | 'failed';

export interface RefreshJob {
  channelId: string;
  channelName: string;
  phase: RefreshPhase;
  startedAt: number;
  result?: ChannelRefreshResult | null;
  error?: string;
  /** Live progress, when the server reports it */
  progress?: ChannelRefreshProgress | null;
  cancelRequested?: boolean;
}

interface ChannelRefreshState {
  jobs: Record<string, RefreshJob>;
  setJob: (job: RefreshJob) => void;
  dismiss: (channelId: string) => void;
}

export const useChannelRefreshStore = create<ChannelRefreshState>((set) => ({
  jobs: {},
  setJob: (job) => set((s) => ({ jobs: { ...s.jobs, [job.channelId]: job } })),
  dismiss: (channelId) =>
    set((s) => {
      const jobs = { ...s.jobs };
      delete jobs[channelId];
      return { jobs };
    })
}));

const OPTIONS_KEY = 'tfm.channelRefreshOptions';
const POLL_INTERVAL_MS = 3000;
// The first status read can arrive before the server flags the scan as
// running. Without a fresh result we wait this long before trusting "idle".
const STARTUP_GRACE_MS = 15000;
const MAX_CONSECUTIVE_ERRORS = 5;

export const DEFAULT_REFRESH_OPTIONS: ChannelRefreshOptions = {
  includeVideo: false,
  includeDocuments: false,
  includePhotos: false,
  force: false
};

export function loadRefreshOptions(): ChannelRefreshOptions {
  try {
    const raw = localStorage.getItem(OPTIONS_KEY);
    if (raw) {
      // "force" is a one-off decision, never remembered
      return { ...DEFAULT_REFRESH_OPTIONS, ...JSON.parse(raw), force: false };
    }
  } catch {
    // ignore corrupt storage
  }
  return { ...DEFAULT_REFRESH_OPTIONS };
}

function saveRefreshOptions(options: ChannelRefreshOptions) {
  try {
    const { includeVideo, includeDocuments, includePhotos } = options;
    localStorage.setItem(OPTIONS_KEY, JSON.stringify({ includeVideo, includeDocuments, includePhotos }));
  } catch {
    // storage full or unavailable: not worth failing the refresh for
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const polling = new Set<string>();

export function describeRefreshResult(result: ChannelRefreshResult): string {
  if (result.total === 0) return t('no new files');
  const parts: string[] = [];
  if (result.audios) parts.push(t('{count} audio', { count: result.audios }));
  if (result.videos) parts.push(t('{count} video', { count: result.videos }));
  if (result.documents) parts.push(t('{count} documents', { count: result.documents }));
  if (result.photos) parts.push(t('{count} photos', { count: result.photos }));
  return t(result.total === 1 ? '{count} new file ({details})' : '{count} new files ({details})', {
    count: result.total,
    details: parts.join(', ')
  });
}

async function readFinishedAt(channelId: string): Promise<string | null> {
  try {
    return (await channelsApi.getRefreshResult(channelId))?.finishedAt ?? null;
  } catch {
    // Older servers have no /refresh/result: fall back to status-only tracking
    return null;
  }
}

async function pollUntilDone(channelId: string, previousFinishedAt: string | null) {
  if (polling.has(channelId)) return;
  polling.add(channelId);

  const store = useChannelRefreshStore.getState;
  const startedAt = Date.now();
  let seenRunning = false;
  let errors = 0;

  try {
    for (;;) {
      await sleep(POLL_INTERVAL_MS);
      const job = store().jobs[channelId];
      if (!job || job.phase !== 'running') return; // dismissed

      let running: boolean;
      try {
        running = await channelsApi.isRefreshing(channelId);
        errors = 0;
      } catch {
        if (++errors >= MAX_CONSECUTIVE_ERRORS) {
          finish(channelId, 'failed', null, t('Lost contact with the server'));
          return;
        }
        continue;
      }

      if (running) {
        seenRunning = true;
        if (await serverCapabilities.has('channels.refreshProgress')) {
          try {
            const progress = await channelsApi.getRefreshProgress(channelId);
            const current = store().jobs[channelId];
            if (current && current.phase === 'running') store().setJob({ ...current, progress });
          } catch {
            // progress is a nicety: keep polling the status
          }
        }
        continue;
      }

      let result: ChannelRefreshResult | null = null;
      try {
        result = await channelsApi.getRefreshResult(channelId);
      } catch {
        result = null;
      }

      // Only a result newer than the one we saw before starting is ours
      const isFresh = !!result && result.finishedAt !== previousFinishedAt;
      if (isFresh) {
        finish(channelId, result!.failed ? 'failed' : 'done', result);
        return;
      }
      if (seenRunning || Date.now() - startedAt > STARTUP_GRACE_MS) {
        finish(channelId, 'done', null);
        return;
      }
    }
  } finally {
    polling.delete(channelId);
  }
}

function finish(channelId: string, phase: RefreshPhase, result: ChannelRefreshResult | null, error?: string) {
  const { jobs, setJob } = useChannelRefreshStore.getState();
  const job = jobs[channelId];
  if (!job) return;
  setJob({ ...job, phase, result, error });

  const { addToast } = useUiStore.getState();
  if (result?.canceled) {
    addToast(t('Refresh of "{name}" cancelled: {detail}', { name: job.channelName, detail: describeRefreshResult(result) }), 'warning');
    return;
  }
  if (phase === 'failed') {
    const detail = error ?? (result ? t('stopped after {detail}', { detail: describeRefreshResult(result) }) : t('scan failed'));
    addToast(t('Refresh of "{name}" failed: {detail}', { name: job.channelName, detail }), 'error');
  } else {
    const detail = result ? describeRefreshResult(result) : t('finished');
    addToast(t('"{name}" refreshed: {detail}', { name: job.channelName, detail }), 'success');
  }
}

export const channelRefreshService = {
  /** Ask the server to stop the scan; the poll loop reports how it ended. */
  async cancel(channelId: string): Promise<void> {
    const job = useChannelRefreshStore.getState().jobs[channelId];
    if (job) useChannelRefreshStore.getState().setJob({ ...job, cancelRequested: true });
    await channelsApi.cancelRefresh(channelId);
  },

  /** Asks the server to scan the channel and tracks it until it finishes. */
  async start(channelId: string, channelName: string, options: ChannelRefreshOptions): Promise<void> {
    saveRefreshOptions(options);
    const previousFinishedAt = await readFinishedAt(channelId);
    const started = await channelsApi.startRefresh(channelId, options);

    useChannelRefreshStore.getState().setJob({
      channelId,
      channelName,
      phase: 'running',
      startedAt: Date.now()
    });

    if (!started) {
      useUiStore.getState().addToast(t('A refresh was already running, following it'), 'info');
    }
    void pollUntilDone(channelId, previousFinishedAt);
  },

  /** Follows a scan somebody else started (e.g. from the web UI). */
  async track(channelId: string, channelName: string): Promise<void> {
    const existing = useChannelRefreshStore.getState().jobs[channelId];
    if (existing?.phase === 'running') return;
    const previousFinishedAt = await readFinishedAt(channelId);
    useChannelRefreshStore.getState().setJob({
      channelId,
      channelName,
      phase: 'running',
      startedAt: Date.now()
    });
    void pollUntilDone(channelId, previousFinishedAt);
  }
};
