import { getV1Api } from '@/services/api/v1';
import { cacheService } from '@/services/cache/CacheService';
import { serverCapabilities } from '@/services/server/capabilities';
import type { Track } from '@/types/models';
import { log } from '@/utils/logger';

// Tracks already asked for this session (the server keeps them in its cache)
const requested = new Set<string>();
const MAX_REMEMBERED = 500;

/**
 * Asks the server to pull a channel track from Telegram into its streaming
 * cache (`files.preload`) while the current one plays, so the changeover
 * doesn't wait for Telegram. Tracks on the device, local files and servers
 * without the feature are skipped. Never throws.
 */
export async function preloadOnServer(track: Track | undefined): Promise<void> {
  if (!track || track.isLocalFile || !track.channelId || !track.fileId) return;
  const key = `${track.channelId}:${track.fileId}`;
  if (requested.has(key)) return;
  try {
    if (!(await serverCapabilities.has('files.preload'))) return;
    if (await cacheService.isTrackCached(track.fileId)) return;
    if (requested.size >= MAX_REMEMBERED) requested.clear();
    requested.add(key);
    await (await getV1Api()).files.preload(track.channelId, { fileIds: [track.fileId] });
    log.debug('Asked the server to preload', track.fileName);
  } catch (error) {
    requested.delete(key);
    log.warn('Server preload failed:', error);
  }
}

/** Test helper. */
export function __resetServerPreload(): void {
  requested.clear();
}
