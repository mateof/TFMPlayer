import * as mm from 'music-metadata';
import { cacheService } from '@/services/cache/CacheService';
import { db, getApiCache, setApiCache } from '@/db/database';
import type { CachedTrackEntity } from '@/db/database';

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

  // True when built from stored fields without parsing the file (background
  // mode): tags/cover are present but technical info may be missing
  partial?: boolean;
}

class AudioMetadataService {
  private metadataCache = new Map<string, AudioMetadata>();

  async getMetadata(trackId: string, streamUrl: string, fileSize?: number): Promise<AudioMetadata | null> {
    // Check cache first
    if (this.metadataCache.has(trackId)) {
      return this.metadataCache.get(trackId)!;
    }

    try {
      // Full metadata persisted from a previous parse: no file work at all
      const persisted = await getApiCache<AudioMetadata>(`trackmeta:${trackId}`);
      if (persisted) {
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
      const metadata = await mm.parseBlob(blob);
      return this.parseMetadata(metadata, blob.size);
    } catch (error) {
      console.error('Failed to extract metadata from blob:', error);
      return null;
    }
  }

  private async extractFromUrl(url: string, fileSize?: number): Promise<AudioMetadata | null> {
    try {
      // Fetch first 256KB to get headers and metadata
      // Most metadata (ID3v2) is at the beginning of the file
      const response = await fetch(url, {
        headers: {
          Range: 'bytes=0-262143' // First 256KB
        }
      });

      if (!response.ok && response.status !== 206) {
        // If range request not supported, try to fetch small amount
        const fullResponse = await fetch(url);
        if (!fullResponse.ok) return null;

        // Read only first 256KB
        const reader = fullResponse.body?.getReader();
        if (!reader) return null;

        const chunks: Uint8Array[] = [];
        let totalRead = 0;
        const maxBytes = 262144;

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

        const metadata = await mm.parseBuffer(buffer, { size: fileSize });
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

      const metadata = await mm.parseBuffer(uint8Array, { size: totalSize });
      return this.parseMetadata(metadata, totalSize);
    } catch (error) {
      console.error('Failed to extract metadata from URL:', error);
      return null;
    }
  }

  private parseMetadata(mm: mm.IAudioMetadata, fileSize?: number): AudioMetadata {
    const format = mm.format;
    const common = mm.common;

    // Extract cover art
    let coverArt: string | undefined;
    if (common.picture && common.picture.length > 0) {
      const pic = common.picture[0];
      const base64 = this.arrayBufferToBase64(pic.data);
      coverArt = `data:${pic.format};base64,${base64}`;
    }

    return {
      // Technical info
      format: format.container,
      codec: format.codec,
      bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : undefined, // Convert to kbps
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

      // Cover art
      coverArt
    };
  }

  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    const len = buffer.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
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
