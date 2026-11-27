import { db, type CachedTrackEntity } from '@/db/database';
import { log } from '@/utils/logger';

class CacheService {
  // Check if a track is cached
  async isTrackCached(trackId: string): Promise<boolean> {
    const cached = await db.cachedTracks.get(trackId);
    return !!cached?.blob;
  }

  /**
   * Which of these tracks are stored on the device, in one IndexedDB
   * round trip (a page of 50 tracks used to cost 50 sequential reads).
   */
  async getCachedTrackIds(trackIds: string[]): Promise<Set<string>> {
    const unique = [...new Set(trackIds)];
    if (unique.length === 0) return new Set();
    const keys = await db.cachedTracks.where(':id').anyOf(unique).filter((t) => !!t.blob).primaryKeys();
    return new Set(keys as string[]);
  }

  // Get cached track
  async getCachedTrack(trackId: string): Promise<CachedTrackEntity | undefined> {
    return db.cachedTracks.get(trackId);
  }

  // Get total cache size in bytes
  async getCacheSize(): Promise<number> {
    const tracks = await db.cachedTracks.toArray();
    return tracks.reduce((acc, t) => acc + t.fileSize, 0);
  }

  // Remove a cached track
  async removeCachedTrack(trackId: string): Promise<void> {
    await db.cachedTracks.delete(trackId);
  }

  // Update last played timestamp
  async updateLastPlayed(trackId: string): Promise<void> {
    await db.cachedTracks.update(trackId, {
      lastPlayedAt: new Date()
    });
  }

  // Evict least-recently-played auto-cached tracks until total size fits maxBytes.
  // Manual downloads are never evicted. maxBytes <= 0 means unlimited.
  async enforceCacheLimit(maxBytes: number, excludeTrackId?: string): Promise<number> {
    if (!maxBytes || maxBytes <= 0) return 0;

    let currentSize = await this.getCacheSize();
    if (currentSize <= maxBytes) return 0;

    const evictable = (await db.cachedTracks.toArray())
      .filter(t => t.autoCached && t.id !== excludeTrackId)
      .sort((a, b) =>
        (a.lastPlayedAt ?? a.cachedAt).getTime() - (b.lastPlayedAt ?? b.cachedAt).getTime()
      );

    let removedCount = 0;
    for (const track of evictable) {
      if (currentSize <= maxBytes) break;
      await db.cachedTracks.delete(track.id);
      currentSize -= track.fileSize;
      removedCount++;
    }

    if (removedCount > 0) {
      log.debug(`Cache limit: evicted ${removedCount} auto-cached tracks`);
    }
    return removedCount;
  }

  // Get cover art for a track (from cache)
  async getCoverArt(trackId: string): Promise<string | undefined> {
    const track = await db.cachedTracks.get(trackId);
    return track?.coverArt;
  }

  /** Cover art for many tracks at once (bulkGet), keyed by track id. */
  async getCoverArts(trackIds: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(trackIds)];
    if (unique.length === 0) return {};
    const tracks = await db.cachedTracks.bulkGet(unique);
    const result: Record<string, string> = {};
    tracks.forEach((track, i) => {
      if (track?.coverArt) result[unique[i]] = track.coverArt;
    });
    return result;
  }
}

export const cacheService = new CacheService();
