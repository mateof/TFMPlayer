import { db, type CachedTrackEntity, updateTrackCoverArt } from '@/db/database';
import type { Track } from '@/types/models';
import * as mm from 'music-metadata';

class CacheService {
  // Check if a track is cached
  async isTrackCached(trackId: string): Promise<boolean> {
    const cached = await db.cachedTracks.get(trackId);
    return !!cached?.blob;
  }

  // Get cached track
  async getCachedTrack(trackId: string): Promise<CachedTrackEntity | undefined> {
    return db.cachedTracks.get(trackId);
  }

  // Get all cached tracks
  async getAllCachedTracks(): Promise<CachedTrackEntity[]> {
    return db.cachedTracks.toArray();
  }

  // Get total cache size in bytes
  async getCacheSize(): Promise<number> {
    const tracks = await db.cachedTracks.toArray();
    return tracks.reduce((acc, t) => acc + t.fileSize, 0);
  }

  // Download and cache a track
  async cacheTrack(
    track: Track,
    onProgress?: (progress: number) => void
  ): Promise<boolean> {
    try {
      // Check if already cached
      const existing = await db.cachedTracks.get(track.fileId);
      if (existing?.blob) {
        return true;
      }

      // Download the track
      const response = await fetch(track.streamUrl);
      if (!response.ok) {
        throw new Error(`Failed to download: ${response.statusText}`);
      }

      const contentLength = response.headers.get('content-length');
      const totalSize = contentLength ? parseInt(contentLength) : track.fileSize;

      // Read the stream with progress
      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('No response body');
      }

      const chunks: BlobPart[] = [];
      let receivedLength = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        receivedLength += value.length;

        if (onProgress && totalSize > 0) {
          onProgress((receivedLength / totalSize) * 100);
        }
      }

      // Combine chunks into blob
      const blob = new Blob(chunks, { type: 'audio/mpeg' });

      // Extract cover art from the audio file
      let coverArt: string | undefined;
      try {
        const buffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(buffer);
        const metadata = await mm.parseBuffer(uint8Array, {
          mimeType: blob.type || 'audio/mpeg',
          size: blob.size
        });

        if (metadata.common.picture && metadata.common.picture.length > 0) {
          const pic = metadata.common.picture[0];
          const base64 = this.arrayBufferToBase64(pic.data);
          coverArt = `data:${pic.format};base64,${base64}`;
        }
      } catch (e) {
        console.warn('Failed to extract cover art:', e);
      }

      // Save to IndexedDB
      const cachedTrack: CachedTrackEntity = {
        id: track.fileId,
        channelId: track.channelId,
        channelName: track.channelName,
        fileName: track.fileName,
        fileSize: blob.size,
        duration: track.duration,
        title: track.title,
        artist: track.artist,
        album: track.album,
        streamUrl: track.streamUrl,
        cachedAt: new Date(),
        blob,
        coverArt
      };

      await db.cachedTracks.put(cachedTrack);
      return true;
    } catch (error) {
      console.error('Failed to cache track:', error);
      return false;
    }
  }

  // Remove a cached track
  async removeCachedTrack(trackId: string): Promise<void> {
    await db.cachedTracks.delete(trackId);
  }

  // Clear all cached tracks
  async clearCache(): Promise<void> {
    await db.cachedTracks.clear();
  }

  // Get blob URL for cached track (for playback)
  async getTrackBlobUrl(trackId: string): Promise<string | null> {
    const cached = await db.cachedTracks.get(trackId);
    if (cached?.blob) {
      return URL.createObjectURL(cached.blob);
    }
    return null;
  }

  // Update last played timestamp
  async updateLastPlayed(trackId: string): Promise<void> {
    await db.cachedTracks.update(trackId, {
      lastPlayedAt: new Date()
    });
  }

  // Get cache statistics
  async getStats(): Promise<{
    trackCount: number;
    totalSize: number;
    oldestTrack?: Date;
    newestTrack?: Date;
  }> {
    const tracks = await db.cachedTracks.toArray();

    if (tracks.length === 0) {
      return { trackCount: 0, totalSize: 0 };
    }

    const totalSize = tracks.reduce((acc, t) => acc + t.fileSize, 0);
    const dates = tracks.map(t => t.cachedAt).sort((a, b) => a.getTime() - b.getTime());

    return {
      trackCount: tracks.length,
      totalSize,
      oldestTrack: dates[0],
      newestTrack: dates[dates.length - 1]
    };
  }

  // Remove old cached tracks to free space (LRU eviction)
  async evictOldTracks(targetSizeBytes: number): Promise<number> {
    const currentSize = await this.getCacheSize();
    if (currentSize <= targetSizeBytes) {
      return 0;
    }

    // Get tracks sorted by last played (oldest first)
    const tracks = await db.cachedTracks
      .orderBy('lastPlayedAt')
      .toArray();

    let freedSize = 0;
    let removedCount = 0;

    for (const track of tracks) {
      if (currentSize - freedSize <= targetSizeBytes) {
        break;
      }

      await db.cachedTracks.delete(track.id);
      freedSize += track.fileSize;
      removedCount++;
    }

    return removedCount;
  }

  // Helper to convert array buffer to base64
  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    const len = buffer.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
  }

  // Update cover art for an existing cached track
  async updateCoverArt(trackId: string, coverArt: string): Promise<void> {
    await updateTrackCoverArt(trackId, coverArt);
  }

  // Get cover art for a track (from cache)
  async getCoverArt(trackId: string): Promise<string | undefined> {
    const track = await db.cachedTracks.get(trackId);
    return track?.coverArt;
  }
}

export const cacheService = new CacheService();
