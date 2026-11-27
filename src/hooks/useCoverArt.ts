import { useEffect, useState } from 'react';
import { cacheService } from '@/services/cache/CacheService';
import { audioMetadataService } from '@/services/audio/AudioMetadataService';
import { audioPlayer } from '@/services/audio/AudioPlayerService';
import { usePlayerStore } from '@/stores/playerStore';

/**
 * Cover art of a track (null while unknown or when there is none): the one
 * stored with the download, else, for the track playing, the one embedded in
 * the head of the stream. The answer is tied to the id it was asked for, so a
 * slow read for the previous track never shows up on the next one.
 */
export function useCoverArt(fileId: string | undefined): string | null {
  const [cover, setCover] = useState<{ id: string; art: string | null } | null>(null);

  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const fromStream = async () => {
      const track = usePlayerStore.getState().currentTrack;
      if (cancelled || !track || track.fileId !== fileId) return;
      const meta = await audioMetadataService.getMetadata(track.fileId, track.streamUrl, track.fileSize);
      if (cancelled || !meta?.coverArt) return;
      setCover({ id: fileId, art: meta.coverArt });
      audioPlayer.updateCoverArt(meta.coverArt);
    };

    // With the screen off the service doesn't parse files: retry once visible
    const onVisible = () => {
      if (!document.hidden) fromStream().catch(() => {});
    };

    cacheService.getCoverArt(fileId)
      .then((art) => {
        if (cancelled) return;
        setCover({ id: fileId, art: art || null });
        if (art) return;
        // Let playback start first
        timeout = setTimeout(() => fromStream().catch(() => {}), 500);
        document.addEventListener('visibilitychange', onVisible);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [fileId]);

  return cover && cover.id === fileId ? cover.art : null;
}
