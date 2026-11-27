import { getV1Api } from '@/services/api/v1';
import { serverCapabilities } from '@/services/server/capabilities';
import type { Track } from '@/types/models';

// data: URL per message (null = it has no thumbnail), for the session
const known = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();
const MAX_REMEMBERED = 300;

function toDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsDataURL(blob);
  });
}

/**
 * The thumbnail Telegram keeps for the message of a channel track
 * (`files.thumbnails`), as a data: URL. Audio uploads often carry the album
 * art there even when the file has no embedded picture. Null when there is
 * none, for local files and on servers without the feature. Never throws.
 */
export async function thumbnailCover(track: Pick<Track, 'channelId' | 'messageId' | 'isLocalFile'>): Promise<string | null> {
  if (track.isLocalFile || !track.channelId || !track.messageId) return null;
  const key = `${track.channelId}:${track.messageId}`;
  if (known.has(key)) return known.get(key)!;
  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      try {
        if (!(await serverCapabilities.has('files.thumbnails'))) return null;
        const v1 = await getV1Api();
        const response = await v1.http.raw(
          'GET',
          `/api/v1/channels/${encodeURIComponent(track.channelId)}/messages/${track.messageId}/thumbnail`,
          { headers: { Accept: 'image/*' } }
        );
        const blob = await response.blob();
        const url = blob.size > 0 && blob.type.startsWith('image/') ? await toDataUrl(blob) : null;
        if (known.size >= MAX_REMEMBERED) known.clear();
        known.set(key, url);
        return url;
      } catch {
        // 404: the message has no thumbnail. Network errors are not remembered
        return null;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, pending);
  }
  return pending;
}

/** Test helper. */
export function __resetThumbnailCovers(): void {
  known.clear();
  inflight.clear();
}
