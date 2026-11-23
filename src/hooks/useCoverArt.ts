import { useEffect, useState } from 'react';
import { cacheService } from '@/services/cache/CacheService';

/**
 * Cover art stored for a track (null while unknown or when there is none).
 * The answer is tied to the id it was asked for, so a slow read for the
 * previous track never shows up on the next one.
 */
export function useCoverArt(fileId: string | undefined): string | null {
  const [cover, setCover] = useState<{ id: string; art: string | null } | null>(null);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    cacheService.getCoverArt(fileId)
      .then((art) => {
        if (!cancelled) setCover({ id: fileId, art: art || null });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  return cover && cover.id === fileId ? cover.art : null;
}
