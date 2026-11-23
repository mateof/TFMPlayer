import { collectChannelFolderTracks, collectLocalFolderTracks, dedupeTracks } from '@/utils/collectTracks';
import type { Track } from '@/types/models';
import { t } from '@/i18n';

/**
 * Desktop drag and drop of tracks onto playlists. Folders travel as a
 * reference and are expanded only when dropped, so starting a drag on a big
 * folder costs nothing.
 */
export const DRAG_MIME = 'application/x-tfm-tracks';

export type DragItem =
  | { kind: 'track'; track: Track }
  | { kind: 'channel-folder'; channelId: string; channelName: string; folderId: string; name: string }
  | { kind: 'local-folder'; path: string; name: string };

export function setDragPayload(e: React.DragEvent, items: DragItem[]) {
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(items));
  // Plain-text fallback so dropping on a text field shows something useful
  e.dataTransfer.setData('text/plain', items.map(describeItem).join('\n'));
}

/** Only the type is readable during dragover; the data arrives on drop. */
export function isTrackDrag(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(DRAG_MIME);
}

export function readDragPayload(e: React.DragEvent): DragItem[] | null {
  const raw = e.dataTransfer.getData(DRAG_MIME);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DragItem[]) : null;
  } catch {
    return null;
  }
}

export function describeItem(item: DragItem): string {
  switch (item.kind) {
    case 'track':
      return item.track.title || item.track.fileName;
    case 'channel-folder':
    case 'local-folder':
      return `${item.name}/`;
  }
}

/** Turns a dropped payload into tracks, walking any folders it carries. */
export async function resolveDragPayload(
  items: DragItem[],
  onProgress?: (label: string) => void
): Promise<Track[]> {
  const tracks: Track[] = [];
  for (const item of items) {
    if (item.kind === 'track') {
      tracks.push(item.track);
    } else if (item.kind === 'channel-folder') {
      onProgress?.(t('Scanning "{name}"...', { name: item.name }));
      tracks.push(...await collectChannelFolderTracks(item.channelId, item.channelName, item.folderId));
    } else {
      onProgress?.(t('Scanning "{name}"...', { name: item.name }));
      tracks.push(...await collectLocalFolderTracks(item.path));
    }
  }
  return dedupeTracks(tracks);
}
