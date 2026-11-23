import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/database';
import { cacheService } from '@/services/cache/CacheService';
import { downloadManager } from './DownloadManager';
import type { Track } from '@/types/models';

const track = (id: string): Track => ({
  fileId: id,
  channelId: '1',
  channelName: 'Music',
  fileName: `${id}.mp3`,
  filePath: '/',
  fileType: '.mp3',
  fileSize: 100,
  order: 0,
  dateAdded: '',
  isLocalFile: false,
  streamUrl: `http://server/${id}`
});

async function cache(id: string, withBlob = true) {
  await db.cachedTracks.put({
    id,
    fileName: `${id}.mp3`,
    fileSize: 1,
    cachedAt: new Date(),
    blob: (withBlob ? new Blob(['x']) : undefined) as Blob
  });
}

describe('bulk cache and download queue', () => {
  beforeEach(async () => {
    await db.cachedTracks.clear();
    await db.downloadQueue.clear();
    // Never start real downloads in tests
    vi.spyOn(downloadManager, 'processQueue').mockResolvedValue();
  });

  it('getCachedTrackIds only reports tracks that have audio stored', async () => {
    await cache('a');
    await cache('b', false); // metadata only
    const found = await cacheService.getCachedTrackIds(['a', 'b', 'c', 'a']);
    expect([...found]).toEqual(['a']);
  });

  it('getCoverArts returns art keyed by id in one read', async () => {
    await db.cachedTracks.put({ id: 'a', fileName: 'a', fileSize: 1, cachedAt: new Date(), blob: new Blob(['x']), coverArt: 'data:a' });
    await cache('b');
    expect(await cacheService.getCoverArts(['a', 'b', 'zz'])).toEqual({ a: 'data:a' });
  });

  it('addMultipleToQueue skips cached tracks and repeats, resets existing items', async () => {
    await cache('cached');
    await db.downloadQueue.add({
      trackId: 'old',
      streamUrl: 'http://stale',
      fileName: 'old.mp3',
      channelId: '1',
      channelName: 'Music',
      fileSize: 1,
      status: 'failed',
      progress: 40,
      errorMessage: 'boom',
      addedAt: new Date()
    });

    await downloadManager.addMultipleToQueue([track('new'), track('cached'), track('old'), track('new')]);

    const items = await db.downloadQueue.toArray();
    expect(items.map((i) => i.trackId).sort()).toEqual(['new', 'old']);
    const old = items.find((i) => i.trackId === 'old')!;
    expect(old).toMatchObject({ status: 'pending', progress: 0, streamUrl: 'http://server/old' });
    expect(old.errorMessage).toBeUndefined();
    expect(downloadManager.processQueue).toHaveBeenCalledTimes(1);
  });

  it('force re-queues tracks that are already cached', async () => {
    await cache('cached');
    await downloadManager.addMultipleToQueue([track('cached')], true);
    expect(await db.downloadQueue.count()).toBe(1);
  });

  it('does nothing when everything is already on the device', async () => {
    await cache('a');
    await downloadManager.addMultipleToQueue([track('a')]);
    expect(await db.downloadQueue.count()).toBe(0);
    expect(downloadManager.processQueue).not.toHaveBeenCalled();
  });
});
