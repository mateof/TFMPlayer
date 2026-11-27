import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types/models';

vi.mock('@/services/api/client', () => ({
  apiClient: { getBaseUrl: () => 'http://server', onReset: () => {}, getApiKey: async () => 'k' },
  buildStreamUrlSync: (ch: string, id: string) => `http://server/api/mobile/stream/tfm/${ch}/${id}`,
  buildLocalStreamUrlSync: (p: string) => `http://server/api/mobile/stream/local?path=${p}`
}));
vi.mock('@/services/server/capabilities', () => ({ serverCapabilities: { has: async () => false } }));

import { fromApiTrack, toApiTrack, trackKey } from './playerTrack';
import { favoritesService, useFavoritesStore } from './FavoritesService';
import { isMessageTrack, messageToTrack, parseMessageTrackId } from '@/utils/messageTracks';
import { db } from '@/db/database';

const track = (extra: Partial<Track> = {}): Track => ({
  fileId: 'f1', channelId: '42', channelName: 'Music', fileName: 'a.mp3', filePath: '/a.mp3', fileType: '.mp3',
  fileSize: 10, order: 0, dateAdded: '', isLocalFile: false, streamUrl: '', ...extra
});

describe('trackKey', () => {
  it('matches the keys the server computes', () => {
    expect(trackKey(track())).toBe('channel:42:f1');
    expect(trackKey(track({ isLocalFile: true, filePath: '\\music\\a.mp3' }))).toBe('local:music/a.mp3');
  });

  it('survives a round trip through the server shape', () => {
    const local = track({ isLocalFile: true, fileId: '/music/a.mp3', filePath: '/music/a.mp3', channelId: 'local' });
    const back = fromApiTrack(toApiTrack(local));
    expect(back.isLocalFile).toBe(true);
    expect(back.fileId).toBe('/music/a.mp3');
    expect(trackKey(back)).toBe(trackKey(local));
  });
});

describe('message tracks', () => {
  it('play from the v1 message content and keep the message id', () => {
    const t = messageToTrack({ id: 88, date: '2026-01-01T00:00:00Z', hasMedia: true, fileName: 'x.mp3', performer: 'Band', title: 'Song' }, '42', 'Music');
    expect(isMessageTrack(t)).toBe(true);
    expect(t.streamUrl).toBe('http://server/api/v1/channels/42/messages/88/content');
    expect(t.messageId).toBe(88);
    expect(parseMessageTrackId(t.fileId)).toEqual({ channelId: '42', messageId: 88 });
    expect(fromApiTrack(toApiTrack(t)).streamUrl).toBe(t.streamUrl);
  });
});

describe('favoritesService without the server', () => {
  beforeEach(async () => {
    await db.apiCache.clear();
    favoritesService.__reset();
  });

  it('keeps favourites on the device', async () => {
    await favoritesService.load();
    expect(await favoritesService.toggle(track())).toBe(true);
    expect(useFavoritesStore.getState().keys.has('channel:42:f1')).toBe(true);
    expect((await favoritesService.list()).map((t) => t.fileId)).toEqual(['f1']);
    expect(await favoritesService.toggle(track())).toBe(false);
    expect(await favoritesService.list()).toEqual([]);
  });
});
