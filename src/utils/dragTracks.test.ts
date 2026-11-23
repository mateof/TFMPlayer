import { describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types/models';

const collectors = vi.hoisted(() => ({
  collectChannelFolderTracks: vi.fn(),
  collectLocalFolderTracks: vi.fn()
}));

vi.mock('@/utils/collectTracks', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/collectTracks')>()),
  ...collectors
}));

import { DRAG_MIME, isTrackDrag, readDragPayload, resolveDragPayload, setDragPayload, type DragItem } from './dragTracks';

const track = (id: string): Track => ({
  fileId: id,
  channelId: '1',
  channelName: 'Music',
  fileName: `${id}.mp3`,
  filePath: '/',
  fileType: '.mp3',
  fileSize: 1,
  order: 0,
  dateAdded: '',
  isLocalFile: false,
  streamUrl: ''
});

// Minimal DataTransfer: jsdom does not implement it
function fakeDragEvent() {
  const store = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: 'none',
    get types() {
      return [...store.keys()];
    },
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? ''
  };
  return { dataTransfer } as unknown as React.DragEvent;
}

describe('drag payload', () => {
  it('round-trips tracks and folder references', () => {
    const e = fakeDragEvent();
    const items: DragItem[] = [
      { kind: 'track', track: track('a') },
      { kind: 'local-folder', path: 'Album', name: 'Album' }
    ];
    setDragPayload(e, items);

    expect(isTrackDrag(e)).toBe(true);
    expect(e.dataTransfer.getData('text/plain')).toBe('a.mp3\nAlbum/');
    expect(readDragPayload(e)).toEqual(items);
  });

  it('ignores foreign or broken drags', () => {
    const e = fakeDragEvent();
    expect(isTrackDrag(e)).toBe(false);
    expect(readDragPayload(e)).toBeNull();
    e.dataTransfer.setData(DRAG_MIME, '{not json');
    expect(readDragPayload(e)).toBeNull();
  });

  it('expands folders on drop and removes repeats', async () => {
    collectors.collectChannelFolderTracks.mockResolvedValue([track('b'), track('a')]);
    collectors.collectLocalFolderTracks.mockResolvedValue([track('c')]);
    const progress = vi.fn();

    const tracks = await resolveDragPayload(
      [
        { kind: 'track', track: track('a') },
        { kind: 'channel-folder', channelId: '1', channelName: 'Music', folderId: 'f', name: 'Rock' },
        { kind: 'local-folder', path: 'Jazz', name: 'Jazz' }
      ],
      progress
    );

    expect(tracks.map((t) => t.fileId)).toEqual(['a', 'b', 'c']);
    expect(collectors.collectChannelFolderTracks).toHaveBeenCalledWith('1', 'Music', 'f');
    expect(progress).toHaveBeenCalledWith('Scanning "Rock"...');
  });
});
