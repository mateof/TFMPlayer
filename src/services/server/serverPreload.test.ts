import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types/models';

const { preload, has, isTrackCached } = vi.hoisted(() => ({
  preload: vi.fn(async () => ({ accepted: 1, skipped: [] as string[] })),
  has: vi.fn(async () => true),
  isTrackCached: vi.fn(async () => false)
}));

vi.mock('@/services/api/v1', () => ({ getV1Api: async () => ({ files: { preload } }) }));
vi.mock('@/services/server/capabilities', () => ({ serverCapabilities: { has } }));
vi.mock('@/services/cache/CacheService', () => ({ cacheService: { isTrackCached } }));

import { __resetServerPreload, preloadOnServer } from './serverPreload';

const track = (id: string, extra: Partial<Track> = {}): Track => ({
  fileId: id, channelId: '42', channelName: 'Music', fileName: `${id}.mp3`, filePath: '/', fileType: '.mp3',
  fileSize: 1, order: 0, dateAdded: '', isLocalFile: false, streamUrl: '', ...extra
});

describe('preloadOnServer', () => {
  beforeEach(() => {
    __resetServerPreload();
    preload.mockClear();
    has.mockResolvedValue(true);
    isTrackCached.mockResolvedValue(false);
  });

  it('asks once per track', async () => {
    await preloadOnServer(track('a'));
    await preloadOnServer(track('a'));
    expect(preload).toHaveBeenCalledTimes(1);
    expect(preload).toHaveBeenCalledWith('42', { fileIds: ['a'] });
  });

  it('skips local files, tracks on the device and servers without the feature', async () => {
    await preloadOnServer(track('l', { isLocalFile: true }));
    isTrackCached.mockResolvedValueOnce(true);
    await preloadOnServer(track('c'));
    has.mockResolvedValueOnce(false);
    await preloadOnServer(track('f'));
    expect(preload).not.toHaveBeenCalled();
  });

  it('asks again after a failure', async () => {
    preload.mockRejectedValueOnce(new Error('down'));
    await preloadOnServer(track('x'));
    await preloadOnServer(track('x'));
    expect(preload).toHaveBeenCalledTimes(2);
  });
});
