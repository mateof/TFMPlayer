import { describe, expect, it, vi } from 'vitest';

vi.mock('@/services/api/client', () => ({
  buildStreamUrlSync: (channelId: string, fileId: string) => `http://server/stream/tfm/${channelId}/${fileId}`,
  buildLocalStreamUrlSync: (path: string) => `http://server/stream/local?path=${path}`
}));

import { fileToTrack, filterFilesByExtension, getApiFilter } from './channelTracks';
import { dedupeTracks, localFileToTrack } from './collectTracks';
import type { ChannelFile } from '@/types/models';

const file = (name: string, category: ChannelFile['category'] = 'Audio'): ChannelFile => ({
  id: name,
  name,
  path: `/${name}`,
  parentId: '',
  size: 1,
  type: name.split('.').pop() ?? '',
  category,
  dateCreated: '2026-01-01',
  dateModified: '2026-01-01',
  isFile: category !== 'Folder',
  hasChildren: false
});

describe('channel filters', () => {
  it('maps UI filters to what the API understands', () => {
    expect(getApiFilter('audio_folders')).toBe('audio_folders');
    expect(getApiFilter('audio')).toBe('audio');
    expect(getApiFilter('flac')).toBe('audio'); // extension filters are client side
  });

  it('filters by extension but keeps folders', () => {
    const files = [file('a.mp3'), file('b.FLAC'), file('Album', 'Folder')];
    expect(filterFilesByExtension(files, 'flac').map((f) => f.name)).toEqual(['b.FLAC', 'Album']);
    expect(filterFilesByExtension(files, 'audio')).toHaveLength(3);
  });
});

describe('track conversion', () => {
  it('builds channel and local tracks', () => {
    const channelTrack = fileToTrack(file('Song.mp3'), '7', 'Music');
    expect(channelTrack).toMatchObject({ channelId: '7', title: 'Song', isLocalFile: false });
    expect(channelTrack.streamUrl).toBe('http://server/stream/tfm/7/Song.mp3');

    const local = localFileToTrack(file('Local.ogg'));
    expect(local).toMatchObject({ channelId: 'local', isLocalFile: true, title: 'Local' });
  });

  it('dedupes by file id keeping the first', () => {
    const a = fileToTrack(file('a.mp3'), '1', 'x');
    const b = fileToTrack(file('b.mp3'), '1', 'x');
    expect(dedupeTracks([a, b, { ...a, title: 'dup' }])).toEqual([a, b]);
  });
});
