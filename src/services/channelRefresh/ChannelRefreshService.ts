import { create } from 'zustand';
import { channelsApi } from '@/services/api/channels.api';
import { useUiStore } from '@/stores/uiStore';
import type { ChannelRefreshOptions, ChannelRefreshResult } from '@/types/models';

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
  if (result.total === 0) return 'no new files';
  const parts: string[] = [];
  if (result.audios) parts.push(`${result.audios} audio`);
  if (result.videos) parts.push(`${result.videos} video`);
  if (result.documents) parts.push(`${result.documents} documents`);
  if (result.photos) parts.push(`${result.photos} photos`);
  return `${result.total} new file${result.total === 1 ? '' : 's'} (${parts.join(', ')})`;
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
          finish(channelId, 'failed', null, 'Lost contact with the server');
          return;
        }
        continue;
      }

      if (running) {
        seenRunning = true;
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
  if (phase === 'failed') {
    const detail = error ?? (result ? `stopped after ${describeRefreshResult(result)}` : 'scan failed');
    addToast(`Refresh of "${job.channelName}" failed: ${detail}`, 'error');
  } else {
    const detail = result ? describeRefreshResult(result) : 'finished';
    addToast(`"${job.channelName}" refreshed: ${detail}`, 'success');
  }
}

export const channelRefreshService = {
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
      useUiStore.getState().addToast('A refresh was already running, following it', 'info');
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
