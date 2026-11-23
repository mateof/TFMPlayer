import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChannelRefreshResult } from '@/types/models';

const api = vi.hoisted(() => ({
  startRefresh: vi.fn(),
  isRefreshing: vi.fn(),
  getRefreshResult: vi.fn(),
  getRefreshProgress: vi.fn(),
  cancelRefresh: vi.fn()
}));
const caps = vi.hoisted(() => ({ has: vi.fn() }));

vi.mock('@/services/api/channels.api', () => ({ channelsApi: api }));
vi.mock('@/services/server/capabilities', () => ({ serverCapabilities: caps }));

import {
  channelRefreshService,
  describeRefreshResult,
  loadRefreshOptions,
  useChannelRefreshStore
} from './ChannelRefreshService';
import { useUiStore } from '@/stores/uiStore';

const result = (finishedAt: string, extra: Partial<ChannelRefreshResult> = {}): ChannelRefreshResult => ({
  channelId: '42',
  startedAt: '2026-01-01T00:00:00Z',
  finishedAt,
  failed: false,
  photos: 0,
  videos: 1,
  audios: 3,
  documents: 0,
  total: 4,
  ...extra
});

const options = { includeVideo: true, includeDocuments: false, includePhotos: false, force: false };
const job = () => useChannelRefreshStore.getState().jobs['42'];
const toasts = () => useUiStore.getState().toasts.map((t) => `${t.type}:${t.message}`);

// Let the poll loop run: each iteration sleeps 3 s and awaits the API
async function advance(ms: number) {
  await vi.advanceTimersByTimeAsync(ms);
}

describe('channelRefreshService', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useChannelRefreshStore.setState({ jobs: {} });
    useUiStore.setState({ toasts: [] });
    localStorage.clear();
    api.startRefresh.mockReset().mockResolvedValue(true);
    api.isRefreshing.mockReset();
    api.getRefreshResult.mockReset();
    api.getRefreshProgress.mockReset();
    api.cancelRefresh.mockReset().mockResolvedValue(true);
    caps.has.mockReset().mockResolvedValue(false);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports the new result once the scan stops', async () => {
    api.getRefreshResult
      .mockResolvedValueOnce(result('old')) // read before starting
      .mockResolvedValue(result('new'));
    api.isRefreshing.mockResolvedValueOnce(true).mockResolvedValue(false);

    await channelRefreshService.start('42', 'Music', options);
    expect(api.startRefresh).toHaveBeenCalledWith('42', options);
    expect(job().phase).toBe('running');

    await advance(3000); // running
    expect(job().phase).toBe('running');
    await advance(3000); // idle + fresh result
    expect(job().phase).toBe('done');
    expect(job().result?.finishedAt).toBe('new');
    expect(toasts()).toContain('success:"Music" refreshed: 4 new files (3 audio, 1 video)');
  });

  it('does not take the previous scan for its own (202 race)', async () => {
    // The first status read arrives before the server marks the scan running
    api.getRefreshResult
      .mockResolvedValueOnce(result('old')) // before starting
      .mockResolvedValueOnce(result('old')) // first idle read: still the old one
      .mockResolvedValue(result('new'));
    api.isRefreshing
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
      .mockResolvedValue(false);

    await channelRefreshService.start('42', 'Music', options);
    await advance(3000);
    expect(job().phase).toBe('running'); // old result ignored
    await advance(3000);
    await advance(3000);
    expect(job().phase).toBe('done');
    expect(job().result?.finishedAt).toBe('new');
  });

  it('follows a scan that was already running (409)', async () => {
    api.startRefresh.mockResolvedValue(false);
    api.getRefreshResult.mockResolvedValueOnce(null).mockResolvedValue(result('new'));
    api.isRefreshing.mockResolvedValue(false);

    await channelRefreshService.start('42', 'Music', options);
    expect(toasts()).toContain('info:A refresh was already running, following it');
    await advance(3000);
    expect(job().phase).toBe('done');
  });

  it('marks the job failed when the server reports a failed scan', async () => {
    api.getRefreshResult.mockResolvedValueOnce(null).mockResolvedValue(result('new', { failed: true }));
    api.isRefreshing.mockResolvedValue(false);

    await channelRefreshService.start('42', 'Music', options);
    await advance(3000);
    expect(job().phase).toBe('failed');
  });

  it('gives up after repeated network errors', async () => {
    api.getRefreshResult.mockResolvedValue(null);
    api.isRefreshing.mockRejectedValue(new Error('offline'));

    await channelRefreshService.start('42', 'Music', options);
    await advance(3000 * 5);
    expect(job().phase).toBe('failed');
    expect(job().error).toBe('Lost contact with the server');
  });

  it('works with servers without /refresh/result (status only)', async () => {
    api.getRefreshResult.mockRejectedValue(new Error('404'));
    api.isRefreshing.mockResolvedValueOnce(true).mockResolvedValue(false);

    await channelRefreshService.start('42', 'Music', options);
    await advance(3000);
    await advance(3000);
    expect(job().phase).toBe('done');
    expect(job().result).toBeNull();
  });

  it('remembers the media types but never "force"', async () => {
    api.getRefreshResult.mockResolvedValue(null);
    api.isRefreshing.mockResolvedValue(true);
    await channelRefreshService.start('42', 'Music', { ...options, includePhotos: true, force: true });

    expect(loadRefreshOptions()).toEqual({
      includeVideo: true,
      includeDocuments: false,
      includePhotos: true,
      force: false
    });
    useChannelRefreshStore.getState().dismiss('42'); // stop the loop
    await advance(3000);
  });
});

describe('channelRefreshService progress and cancel', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useChannelRefreshStore.setState({ jobs: {} });
    useUiStore.setState({ toasts: [] });
    api.startRefresh.mockReset().mockResolvedValue(true);
    api.isRefreshing.mockReset();
    api.getRefreshResult.mockReset();
    api.getRefreshProgress.mockReset();
    api.cancelRefresh.mockReset().mockResolvedValue(true);
    caps.has.mockReset().mockResolvedValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('stores live progress while the scan runs', async () => {
    const progress = { running: true, phase: 'searching', startedAt: '', filters: [{ type: 'audio', fetched: 100, total: 400, done: false }], newFiles: 0, indexed: 0, cancelRequested: false };
    api.getRefreshResult.mockResolvedValue(null);
    api.isRefreshing.mockResolvedValue(true);
    api.getRefreshProgress.mockResolvedValue(progress);

    await channelRefreshService.start('42', 'Music', options);
    await advance(3000);
    expect(job().progress).toEqual(progress);
    useChannelRefreshStore.getState().dismiss('42');
    await advance(3000);
  });

  it('reports a cancelled scan with a warning, not as a success', async () => {
    api.getRefreshResult
      .mockResolvedValueOnce(result('old'))
      .mockResolvedValue(result('new', { canceled: true, total: 2, audios: 2, videos: 0 }));
    api.isRefreshing.mockResolvedValueOnce(true).mockResolvedValue(false);
    api.getRefreshProgress.mockResolvedValue(null);

    await channelRefreshService.start('42', 'Music', options);
    await channelRefreshService.cancel('42');
    expect(api.cancelRefresh).toHaveBeenCalledWith('42');
    expect(job().cancelRequested).toBe(true);

    await advance(3000);
    await advance(3000);
    expect(toasts().some((tst) => tst.startsWith('warning:') && tst.includes('2 new files'))).toBe(true);
    expect(toasts().some((tst) => tst.startsWith('success:'))).toBe(false);
  });
});

describe('describeRefreshResult', () => {
  it('summarises per type and handles empty scans', () => {
    expect(describeRefreshResult(result('x', { total: 0, audios: 0, videos: 0 }))).toBe('no new files');
    expect(describeRefreshResult(result('x', { total: 1, audios: 1, videos: 0 }))).toBe('1 new file (1 audio)');
  });
});
