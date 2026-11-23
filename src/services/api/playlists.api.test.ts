import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import type { Track } from '@/types/models';

const http = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
const caps = vi.hoisted(() => ({ has: vi.fn(), markUnavailable: vi.fn() }));

vi.mock('./client', () => ({
  apiClient: { getClient: async () => http },
  buildStreamUrlSync: () => 'http://server/stream',
  buildLocalStreamUrlSync: () => 'http://server/local'
}));
vi.mock('@/services/server/capabilities', () => ({ serverCapabilities: caps }));

import { playlistsApi } from './playlists.api';

function httpError(status: number) {
  return new AxiosError('failed', String(status), undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {}
  });
}

const track = (i: number): Track => ({
  fileId: `f${i}`,
  channelId: '1',
  channelName: 'Music',
  fileName: `song${i}.mp3`,
  filePath: '/',
  fileType: '.mp3',
  fileSize: 100,
  order: 0,
  dateAdded: '',
  isLocalFile: false,
  streamUrl: 'http://server/stream',
  title: `Song ${i}`
});

describe('playlistsApi.addTracks', () => {
  beforeEach(() => {
    http.post.mockReset();
    caps.has.mockReset();
    caps.markUnavailable.mockReset();
  });

  it('uses the bulk endpoint in chunks when the server supports it', async () => {
    caps.has.mockResolvedValue(true);
    http.post.mockImplementation(async (_url: string, body: { tracks: unknown[] }) => ({
      data: { data: { added: body.tracks.length - 1, skipped: 1, total: 0 } }
    }));
    const progress = vi.fn();

    const tracks = Array.from({ length: 1200 }, (_, i) => track(i));
    const result = await playlistsApi.addTracks('p1', tracks, progress);

    expect(http.post).toHaveBeenCalledTimes(3); // 500 + 500 + 200
    expect(http.post.mock.calls[0][0]).toBe('/api/mobile/playlists/p1/tracks/bulk');
    expect(result).toEqual({ added: 1197, duplicates: 3, failed: 0 });
    expect(progress).toHaveBeenLastCalledWith(1200, 1200);
  });

  it('sends only the fields the server reads', async () => {
    caps.has.mockResolvedValue(true);
    http.post.mockResolvedValue({ data: { data: { added: 2, skipped: 0, total: 2 } } });
    await playlistsApi.addTracks('p1', [track(1), track(2)]);

    const sent = http.post.mock.calls[0][1].tracks[0];
    expect(sent).toMatchObject({ fileId: 'f1', channelId: '1', fileName: 'song1.mp3', channelName: 'Music' });
    expect(sent).not.toHaveProperty('title');
  });

  it('falls back to one by one when the bulk endpoint is missing', async () => {
    caps.has.mockResolvedValue(true);
    http.post.mockImplementation(async (url: string) => {
      if (url.endsWith('/bulk')) throw httpError(404);
      return { data: {} };
    });

    const result = await playlistsApi.addTracks('p1', [track(1), track(2)]);

    expect(caps.markUnavailable).toHaveBeenCalledWith('playlist.bulkAdd');
    expect(http.post).toHaveBeenCalledTimes(3); // failed bulk + 2 singles
    expect(result).toEqual({ added: 2, duplicates: 0, failed: 0 });
  });

  it('goes one by one on old servers and counts 409 as duplicates', async () => {
    caps.has.mockResolvedValue(false);
    http.post
      .mockResolvedValueOnce({ data: {} })
      .mockRejectedValueOnce(httpError(409))
      .mockRejectedValueOnce(httpError(500));

    const result = await playlistsApi.addTracks('p1', [track(1), track(2), track(3)]);

    expect(http.post.mock.calls.every(([url]) => url === '/api/mobile/playlists/p1/tracks')).toBe(true);
    expect(result).toEqual({ added: 1, duplicates: 1, failed: 1 });
  });

  it('does not ask for capabilities for a single track', async () => {
    http.post.mockResolvedValue({ data: {} });
    await playlistsApi.addTracks('p1', [track(1)]);
    expect(caps.has).not.toHaveBeenCalled();
  });

  it('counts a failing later chunk as failed without falling back', async () => {
    caps.has.mockResolvedValue(true);
    http.post
      .mockResolvedValueOnce({ data: { data: { added: 500, skipped: 0, total: 500 } } })
      .mockRejectedValueOnce(httpError(500));

    const tracks = Array.from({ length: 700 }, (_, i) => track(i));
    const result = await playlistsApi.addTracks('p1', tracks);

    expect(result).toEqual({ added: 500, duplicates: 0, failed: 200 });
    expect(caps.markUnavailable).not.toHaveBeenCalled();
  });
});
