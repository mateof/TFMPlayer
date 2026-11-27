import { loadMusicMetadata } from '@/utils/musicMetadata';
import type { IAudioMetadata } from 'music-metadata';
import { cacheService } from '@/services/cache/CacheService';
import { db, getApiCache, setApiCache } from '@/db/database';
import type { CachedTrackEntity } from '@/db/database';
import { tagsFromMetadata } from '@/utils/audioTags';
import { apiClient } from '@/services/api/client';

export interface AudioMetadata {
  // Technical info
  format?: string;
  codec?: string;
  bitrate?: number;
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
  duration?: number;
  fileSize?: number;

  // Tags
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  genre?: string[];
  track?: { no: number | null; of: number | null };
  disk?: { no: number | null; of: number | null };
  comment?: string[];

  // Cover art
  coverArt?: string; // Base64 data URL

  // ReplayGain from the tags (dB and linear peak)
  replayGainDb?: number;
  replayGainPeak?: number;

  // True when built from stored fields without parsing the file (background
  // mode): tags/cover are present but technical info may be missing
  partial?: boolean;

  // What the persisted entry was parsed from. Older entries have none: those
  // read from the stream may have lost a cover that didn't fit the head read.
  source?: 'blob' | 'url';
}

// The tags (and the embedded picture) live at the start of the file: a large
// cover needs more than 256 KB
const HEAD_BYTES = 512 * 1024;

class AudioMetadataService {
  private metadataCache = new Map<string, AudioMetadata>();
  private inflight = new Map<string, Promise<AudioMetadata | null>>();

  // Several views ask for the current track at once: they share one read
  getMetadata(trackId: string, streamUrl: string, fileSize?: number): Promise<AudioMetadata | null> {
    const cached = this.metadataCache.get(trackId);
    if (cached) return Promise.resolve(cached);
    let pending = this.inflight.get(trackId);
    if (!pending) {
      pending = this.loadMetadata(trackId, streamUrl, fileSize).finally(() => this.inflight.delete(trackId));
      this.inflight.set(trackId, pending);
    }
    return pending;
  }

  private async loadMetadata(trackId: string, streamUrl: string, fileSize?: number): Promise<AudioMetadata | null> {
    try {
      // Full metadata persisted from a previous parse: no file work at all
      const persisted = await getApiCache<AudioMetadata>(`trackmeta:${trackId}`);
      if (persisted && (persisted.coverArt || persisted.source)) {
        this.metadataCache.set(trackId, persisted);
        return persisted;
      }

      const cachedTrack = await cacheService.getCachedTrack(trackId);

      // In the background (screen off / tab hidden) never parse audio files:
      // the CPU/memory spike right after a track change can get the PWA killed
      // by the OS. Serve the fields stored at download time instead.
      if (document.hidden) {
        return cachedTrack ? this.fromStoredFields(cachedTrack) : null;
      }

      if (cachedTrack?.blob) {
        const metadata = await this.extractFromBlob(cachedTrack.blob);
        if (metadata) {
          metadata.fileSize = cachedTrack.fileSize;
          metadata.source = 'blob';
          this.metadataCache.set(trackId, metadata);
          await this.persistMetadata(trackId, cachedTrack, metadata);
          return metadata;
        }
      }

      // Try to fetch partial data from URL for streaming tracks (pointless
      // without network)
      if (!navigator.onLine) return null;
      const metadata = await this.extractFromUrl(streamUrl, fileSize);
      if (metadata) {
        metadata.source = 'url';
        this.metadataCache.set(trackId, metadata);
        setApiCache(`trackmeta:${trackId}`, metadata).catch(() => {});
        return metadata;
      }

      return null;
    } catch (error) {
      console.error('Failed to get metadata:', error);
      return null;
    }
  }

  // Build lightweight metadata from what was stored when the track was cached
  private fromStoredFields(track: CachedTrackEntity): AudioMetadata {
    return {
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration,
      fileSize: track.fileSize,
      coverArt: track.coverArt,
      replayGainDb: track.replayGainDb,
      replayGainPeak: track.replayGainPeak,
      partial: true
    };
  }

  // Save the full parse result so it never has to be repeated, and backfill
  // the cached track record used by list views
  private async persistMetadata(
    trackId: string,
    track: CachedTrackEntity,
    metadata: AudioMetadata
  ): Promise<void> {
    try {
      await setApiCache(`trackmeta:${trackId}`, metadata);
      if (!track.metadataExtracted) {
        await db.cachedTracks.update(trackId, {
          title: metadata.title ?? track.title,
          artist: metadata.artist ?? track.artist,
          album: metadata.album ?? track.album,
          duration: metadata.duration ?? track.duration,
          coverArt: metadata.coverArt ?? track.coverArt,
          replayGainDb: metadata.replayGainDb ?? track.replayGainDb,
          replayGainPeak: metadata.replayGainPeak ?? track.replayGainPeak,
          metadataExtracted: true
        });
      }
    } catch (error) {
      console.warn('Failed to persist metadata:', error);
    }
  }

  private async extractFromBlob(blob: Blob): Promise<AudioMetadata | null> {
    try {
      // parseBlob streams the file instead of copying it whole into memory
      const metadata = await (await loadMusicMetadata()).parseBlob(blob);
      return this.parseMetadata(metadata, blob.size);
    } catch (error) {
      console.error('Failed to extract metadata from blob:', error);
      return null;
    }
  }

  private async extractFromUrl(url: string, fileSize?: number): Promise<AudioMetadata | null> {
    try {
      // The stored stream URL has no key: the server answers 401 without it
      const apiKey = await apiClient.getApiKey();
      const auth: Record<string, string> = apiKey ? { 'X-API-Key': apiKey } : {};
      // Fetch the head of the file, where the tags and the picture are
      const response = await fetch(url, {
        headers: { ...auth, Range: `bytes=0-${HEAD_BYTES - 1}` }
      });

      if (!response.ok && response.status !== 206) {
        // If range request not supported, try to fetch small amount
        const fullResponse = await fetch(url, { headers: auth });
        if (!fullResponse.ok) return null;

        // Read only the head
        const reader = fullResponse.body?.getReader();
        if (!reader) return null;

        const chunks: Uint8Array[] = [];
        let totalRead = 0;
        const maxBytes = HEAD_BYTES;

        while (totalRead < maxBytes) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          totalRead += value.length;
        }
        reader.cancel();

        const buffer = new Uint8Array(totalRead);
        let offset = 0;
        for (const chunk of chunks) {
          buffer.set(chunk.slice(0, Math.min(chunk.length, maxBytes - offset)), offset);
          offset += chunk.length;
          if (offset >= maxBytes) break;
        }

        const metadata = await (await loadMusicMetadata()).parseBuffer(buffer, { size: fileSize }, { skipPostHeaders: true });
        return this.parseMetadata(metadata, fileSize);
      }

      const buffer = await response.arrayBuffer();
      const uint8Array = new Uint8Array(buffer);

      // Get content-length from headers for total file size
      const contentRange = response.headers.get('content-range');
      let totalSize = fileSize;
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)/);
        if (match) {
          totalSize = parseInt(match[1]);
        }
      }

      const metadata = await (await loadMusicMetadata()).parseBuffer(uint8Array, { size: totalSize }, { skipPostHeaders: true });
      return this.parseMetadata(metadata, totalSize);
    } catch (error) {
      console.error('Failed to extract metadata from URL:', error);
      return null;
    }
  }

  private parseMetadata(mm: IAudioMetadata, fileSize?: number): AudioMetadata {
    const { format, common } = mm;
    const tags = tagsFromMetadata(mm);
    return {
      // Technical info
      format: format.container,
      codec: format.codec,
      bitrate: tags.audioBitrate,
      sampleRate: format.sampleRate,
      channels: format.numberOfChannels,
      bitsPerSample: format.bitsPerSample,
      duration: format.duration,
      fileSize,

      // Tags
      title: common.title,
      artist: common.artist,
      album: common.album,
      year: common.year,
      genre: common.genre,
      track: common.track,
      disk: common.disk,
      comment: common.comment?.map(c => typeof c === 'string' ? c : c.text).filter((c): c is string => !!c),

      coverArt: tags.coverArt,
      replayGainDb: tags.replayGainDb,
      replayGainPeak: tags.replayGainPeak
    };
  }
  // Clear metadata cache for a specific track
  clearCache(trackId: string): void {
    this.metadataCache.delete(trackId);
  }

  // Clear all metadata cache
  clearAllCache(): void {
    this.metadataCache.clear();
  }
}

export const audioMetadataService = new AudioMetadataService();
