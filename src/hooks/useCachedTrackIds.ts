import { useEffect, useMemo, useState } from 'react';
import { cacheService } from '@/services/cache/CacheService';
import { useDownloadStore } from '@/services/download/DownloadManager';

const ACTIVE_DOWNLOAD_POLL_MS = 2000;

/**
 * Which of the given tracks are stored on the device. One bulk IndexedDB
 * read per change of the list, kept up to date as downloads complete.
 */
export function useCachedTrackIds(trackIds: string[]): Set<string> {
  const [cached, setCached] = useState<Set<string>>(new Set());
  const activeDownloads = useDownloadStore((s) => s.activeDownloads);
  const completedDownloads = useDownloadStore((s) => s.completedDownloads);
  const clearCompleted = useDownloadStore((s) => s.clearCompleted);

  // Stable key: a re-render with the same ids must not re-read the DB
  const idsKey = useMemo(() => trackIds.join('|'), [trackIds]);

  useEffect(() => {
    if (!idsKey) return;
    let cancelled = false;
    cacheService.getCachedTrackIds(idsKey.split('|')).then((found) => {
      if (!cancelled) setCached(found);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [idsKey]);

  // A download finished for something on screen: read the state back
  useEffect(() => {
    const done = trackIds.filter((id) => completedDownloads.has(id));
    if (done.length === 0) return;
    done.forEach((id) => clearCompleted(id));
    cacheService.getCachedTrackIds(trackIds).then(setCached).catch(() => {});
  }, [completedDownloads, trackIds, clearCompleted]);

  // Safety net while downloads for this view are running
  const hasActive = trackIds.some((id) => activeDownloads.has(id));
  useEffect(() => {
    if (!hasActive || !idsKey) return;
    const ids = idsKey.split('|');
    const interval = setInterval(() => {
      cacheService.getCachedTrackIds(ids).then(setCached).catch(() => {});
    }, ACTIVE_DOWNLOAD_POLL_MS);
    return () => clearInterval(interval);
  }, [hasActive, idsKey]);

  return cached;
}
