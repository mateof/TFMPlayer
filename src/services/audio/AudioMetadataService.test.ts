import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db, setApiCache } from '@/db/database';
import { apiClient } from '@/services/api/client';
import { audioMetadataService } from './AudioMetadataService';

vi.mock('@/utils/musicMetadata', () => ({
  loadMusicMetadata: async () => ({
    parseBuffer: async () => ({
      format: {},
      common: { title: 'Song', picture: [{ format: 'image/jpeg', data: new Uint8Array([1, 2, 3]) }] }
    })
  })
}));

const fetchMock = vi.fn(async () => new Response(new Uint8Array(8), { status: 206, headers: { 'content-range': 'bytes 0-7/100' } }));

describe('audioMetadataService', () => {
  beforeEach(async () => {
    audioMetadataService.clearAllCache();
    await db.apiCache.clear();
    await db.cachedTracks.clear();
    fetchMock.mockClear();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(apiClient, 'getApiKey').mockResolvedValue('secret');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reads the cover of a streamed track with the API key and a 512 KB head', async () => {
    const meta = await audioMetadataService.getMetadata('t1', 'http://server/stream/t1', 100);
    expect(meta?.coverArt).toBe('data:image/jpeg;base64,AQID');
    const init = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.headers).toMatchObject({ 'X-API-Key': 'secret', Range: 'bytes=0-524287' });
  });

  it('shares one read between views asking at once', async () => {
    await Promise.all([
      audioMetadataService.getMetadata('t2', 'http://server/stream/t2'),
      audioMetadataService.getMetadata('t2', 'http://server/stream/t2')
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reads again an old stored entry without a cover', async () => {
    await setApiCache('trackmeta:t3', { title: 'Old' });
    const meta = await audioMetadataService.getMetadata('t3', 'http://server/stream/t3');
    expect(meta?.coverArt).toBeDefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
