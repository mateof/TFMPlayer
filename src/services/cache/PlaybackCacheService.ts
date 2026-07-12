import * as mm from 'music-metadata';
import { db } from '@/db/database';
import { apiClient, buildLocalStreamUrlSync } from '@/services/api/client';
import { cacheService } from '@/services/cache/CacheService';
import { useDownloadStore } from '@/services/download/DownloadManager';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Track } from '@/types/models';

const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks (matching server's chunk size)

// Downloads the currently-streaming track in the background and stores it in
// IndexedDB, so seeking backwards or replaying reuses the local copy instead
// of re-downloading from the server.
class PlaybackCacheService {
  private abortController: AbortController | null = null;
  private cachingTrackId: string | null = null;
  private onCachedCallback: ((trackId: string, blob: Blob) => void) | null = null;
  private onProgressCallback: ((trackId: string, percent: number) => void) | null = null;

  // Register a callback fired when a track finishes caching (used by the player
  // to switch the current source to the local blob)
  onCached(callback: (trackId: string, blob: Blob) => void): void {
    this.onCachedCallback = callback;
  }

  // Register a callback fired as the background download advances (0-100)
  onProgress(callback: (trackId: string, percent: number) => void): void {
    this.onProgressCallback = callback;
  }

  isCaching(trackId: string): boolean {
    return this.cachingTrackId === trackId;
  }

  cancel(): void {
    this.abortController?.abort();
    this.abortController = null;
    this.cachingTrackId = null;
  }

  async cacheTrackInBackground(track: Track): Promise<void> {
    const { autoCacheEnabled } = useSettingsStore.getState();
    if (!autoCacheEnabled) return;

    // Already working on this track
    if (this.cachingTrackId === track.fileId) return;

    // Already cached: leave any in-flight job (e.g. the previous track) running
    if (await cacheService.isTrackCached(track.fileId)) return;

    // DownloadManager is already downloading it for offline use
    if (useDownloadStore.getState().activeDownloads.has(track.fileId)) return;

    // Only one background cache at a time: cancel the previous one
    this.cancel();
    const controller = new AbortController();
    this.abortController = controller;
    this.cachingTrackId = track.fileId;

    try {
      const blob = await this.downloadFullFile(track, controller.signal);
      if (controller.signal.aborted) return;

      const metadata = await this.extractMetadata(blob);

      await db.cachedTracks.put({
        id: track.fileId,
        channelId: track.channelId,
        channelName: track.channelName,
        fileName: track.fileName,
        fileSize: blob.size,
        streamUrl: track.streamUrl,
        cachedAt: new Date(),
        lastPlayedAt: new Date(),
        blob,
        title: metadata.title ?? track.title,
        artist: metadata.artist ?? track.artist,
        album: metadata.album ?? track.album,
        duration: metadata.duration ?? track.duration,
        coverArt: metadata.coverArt,
        metadataExtracted: true,
        autoCached: true
      });

      console.log('Auto-cached track:', track.fileName, 'Size:', blob.size);

      const { maxCacheSizeMB } = useSettingsStore.getState();
      await cacheService.enforceCacheLimit(maxCacheSizeMB * 1024 * 1024, track.fileId);

      this.onCachedCallback?.(track.fileId, blob);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        console.warn('Auto-cache failed for', track.fileName, error);
      }
    } finally {
      if (this.abortController === controller) {
        this.abortController = null;
        this.cachingTrackId = null;
      }
    }
  }

  private async downloadFullFile(track: Track, signal: AbortSignal): Promise<Blob> {
    const apiKey = await apiClient.getApiKey();
    const url = track.isLocalFile
      ? buildLocalStreamUrlSync(track.filePath)
      : track.streamUrl;

    const chunks: BlobPart[] = [];
    let downloaded = 0;
    let totalSize = track.fileSize || 0;

    while (true) {
      if (signal.aborted) {
        throw new DOMException('Cache download cancelled', 'AbortError');
      }

      const end = totalSize > 0
        ? Math.min(downloaded + CHUNK_SIZE - 1, totalSize - 1)
        : downloaded + CHUNK_SIZE - 1;

      const response = await fetch(url, {
        signal,
        headers: {
          'X-API-Key': apiKey,
          'Range': `bytes=${downloaded}-${end}`
        }
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`Chunk fetch failed: HTTP ${response.status}`);
      }

      // Server ignored the Range header and returned the whole file
      if (response.status === 200 && downloaded === 0) {
        const blob = await response.blob();
        this.onProgressCallback?.(track.fileId, 100);
        return blob;
      }

      const contentRange = response.headers.get('content-range');
      const match = contentRange?.match(/\/(\d+)$/);
      if (match) {
        totalSize = parseInt(match[1]);
      }

      const chunk = await response.arrayBuffer();
      if (chunk.byteLength === 0) break;

      chunks.push(chunk);
      downloaded += chunk.byteLength;

      if (totalSize > 0) {
        this.onProgressCallback?.(
          track.fileId,
          Math.min(100, Math.round((downloaded / totalSize) * 100))
        );
      }

      if (totalSize > 0 && downloaded >= totalSize) break;
    }

    return new Blob(chunks, { type: 'audio/mpeg' });
  }

  private async extractMetadata(blob: Blob): Promise<{
    title?: string;
    artist?: string;
    album?: string;
    duration?: number;
    coverArt?: string;
  }> {
    try {
      const buffer = await blob.arrayBuffer();
      const metadata = await mm.parseBuffer(new Uint8Array(buffer), {
        mimeType: blob.type || 'audio/mpeg',
        size: blob.size
      });

      let coverArt: string | undefined;
      if (metadata.common.picture && metadata.common.picture.length > 0) {
        const pic = metadata.common.picture[0];
        coverArt = `data:${pic.format};base64,${this.arrayBufferToBase64(pic.data)}`;
      }

      return {
        title: metadata.common.title,
        artist: metadata.common.artist,
        album: metadata.common.album,
        duration: metadata.format.duration,
        coverArt
      };
    } catch (error) {
      console.warn('Failed to extract metadata:', error);
      return {};
    }
  }

  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    const len = buffer.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
  }
}

export const playbackCache = new PlaybackCacheService();
