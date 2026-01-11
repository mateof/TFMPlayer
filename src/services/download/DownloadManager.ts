import { db, type DownloadQueueEntity } from '@/db/database';
import { cacheService } from '@/services/cache/CacheService';
import { apiClient } from '@/services/api/client';
import type { Track } from '@/types/models';
import { create } from 'zustand';

// Download store for reactive state
interface DownloadState {
  activeDownloads: Map<string, number>; // trackId -> progress
  completedDownloads: Set<string>; // trackIds that just completed (for reactive updates)
  isProcessing: boolean;
  setProgress: (trackId: string, progress: number) => void;
  markCompleted: (trackId: string) => void;
  clearCompleted: (trackId: string) => void;
  setProcessing: (processing: boolean) => void;
}

export const useDownloadStore = create<DownloadState>((set) => ({
  activeDownloads: new Map(),
  completedDownloads: new Set(),
  isProcessing: false,
  setProgress: (trackId, progress) =>
    set((state) => {
      const newMap = new Map(state.activeDownloads);
      newMap.set(trackId, progress);
      return { activeDownloads: newMap };
    }),
  markCompleted: (trackId) =>
    set((state) => {
      const newMap = new Map(state.activeDownloads);
      newMap.delete(trackId);
      const newCompleted = new Set(state.completedDownloads);
      newCompleted.add(trackId);
      return { activeDownloads: newMap, completedDownloads: newCompleted };
    }),
  clearCompleted: (trackId) =>
    set((state) => {
      const newCompleted = new Set(state.completedDownloads);
      newCompleted.delete(trackId);
      return { completedDownloads: newCompleted };
    }),
  setProcessing: (processing) => set({ isProcessing: processing })
}));

class DownloadManager {
  private isProcessing = false;
  private abortControllers = new Map<string, AbortController>();

  // Add track to download queue
  async addToQueue(track: Track): Promise<void> {
    // Check if already cached
    const isCached = await cacheService.isTrackCached(track.fileId);
    if (isCached) {
      console.log('Track already cached:', track.fileName);
      return;
    }

    // Check if already in queue
    const existing = await db.downloadQueue
      .where('trackId')
      .equals(track.fileId)
      .first();

    if (existing) {
      // Reset existing item and update streamUrl for re-download
      await db.downloadQueue.update(existing.id!, {
        status: 'pending',
        progress: 0,
        streamUrl: track.streamUrl, // Update in case URL changed (http->https)
        errorMessage: undefined
      });
      console.log('Track reset in queue:', track.fileName);

      // Start processing if not already
      this.processQueue();
      return;
    }

    // Add new to queue
    const queueItem: Omit<DownloadQueueEntity, 'id'> = {
      trackId: track.fileId,
      streamUrl: track.streamUrl,
      fileName: track.fileName,
      channelId: track.channelId,
      channelName: track.channelName,
      fileSize: track.fileSize,
      status: 'pending',
      progress: 0,
      addedAt: new Date()
    };

    await db.downloadQueue.add(queueItem as DownloadQueueEntity);

    // Start processing if not already
    this.processQueue();
  }

  // Add multiple tracks to queue
  async addMultipleToQueue(tracks: Track[]): Promise<void> {
    console.log(`Adding ${tracks.length} tracks to download queue...`);
    for (const track of tracks) {
      await this.addToQueue(track);
    }
    // Ensure queue processing starts after all items are added
    console.log('All tracks added, ensuring queue processing...');
    // Small delay to allow any current processing to finish checking
    setTimeout(() => {
      if (!this.isProcessing) {
        this.processQueue();
      }
    }, 100);
  }

  // Process the download queue
  async processQueue(): Promise<void> {
    if (this.isProcessing) {
      console.log('Download queue already processing');
      return;
    }

    this.isProcessing = true;
    useDownloadStore.getState().setProcessing(true);
    console.log('Starting download queue processing...');

    try {
      let processedCount = 0;
      while (true) {
        // Get next pending item
        const item = await db.downloadQueue
          .where('status')
          .equals('pending')
          .first();

        if (!item) {
          console.log(`Queue processing complete. Processed ${processedCount} items.`);
          break;
        }

        console.log(`Processing download: ${item.fileName}`);
        await this.downloadItem(item);
        processedCount++;
      }
    } catch (error) {
      console.error('Queue processing error:', error);
    } finally {
      this.isProcessing = false;
      useDownloadStore.getState().setProcessing(false);
    }
  }

  // Force restart queue processing (useful if stuck)
  async restartQueue(): Promise<void> {
    console.log('Force restarting download queue...');
    this.isProcessing = false;

    // Reset any stuck 'downloading' items back to pending
    const stuckItems = await db.downloadQueue
      .where('status')
      .equals('downloading')
      .toArray();

    for (const item of stuckItems) {
      await db.downloadQueue.update(item.id!, { status: 'pending', progress: 0 });
    }

    await this.processQueue();
  }

  // Download file in chunks when server returns partial content
  private async downloadInChunks(
    item: DownloadQueueEntity,
    apiKey: string,
    totalSize: number,
    signal: AbortSignal
  ): Promise<Blob> {
    const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks (matching server's chunk size)
    const chunks: BlobPart[] = [];
    let downloaded = 0;

    while (downloaded < totalSize) {
      if (signal.aborted) {
        throw new DOMException('Download cancelled', 'AbortError');
      }

      const end = Math.min(downloaded + CHUNK_SIZE - 1, totalSize - 1);
      const rangeHeader = `bytes=${downloaded}-${end}`;

      console.log(`Downloading chunk: ${rangeHeader}`);

      const response = await fetch(item.streamUrl, {
        signal,
        headers: {
          'X-API-Key': apiKey,
          'Range': rangeHeader
        }
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`Chunk fetch failed: HTTP ${response.status}`);
      }

      const chunk = await response.arrayBuffer();
      chunks.push(chunk);
      downloaded += chunk.byteLength;

      // Update progress
      const progress = Math.round((downloaded / totalSize) * 100);
      await db.downloadQueue.update(item.id!, { progress });
      useDownloadStore.getState().setProgress(item.trackId, progress);

      console.log(`Downloaded ${downloaded} / ${totalSize} bytes (${progress}%)`);
    }

    return new Blob(chunks, { type: 'audio/mpeg' });
  }

  // Download a single item
  private async downloadItem(item: DownloadQueueEntity): Promise<void> {
    const abortController = new AbortController();
    this.abortControllers.set(item.trackId, abortController);

    try {
      // Update status to downloading
      await db.downloadQueue.update(item.id!, { status: 'downloading' });

      // Get API key for authentication
      const apiKey = await apiClient.getApiKey();

      // First request to check file size and if server returns partial content
      const response = await fetch(item.streamUrl, {
        signal: abortController.signal,
        headers: {
          'X-API-Key': apiKey,
          'Range': 'bytes=0-' // Request full file
        }
      });

      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      // Check for partial response
      const contentRange = response.headers.get('content-range');
      const contentLength = response.headers.get('content-length');

      let totalSize = contentLength ? parseInt(contentLength) : item.fileSize;

      // Extract total size from Content-Range header if present
      // Format: "bytes 0-2097152/10801665" - we need the total (10801665)
      if (contentRange) {
        const match = contentRange.match(/\/(\d+)$/);
        if (match) {
          totalSize = parseInt(match[1]);
          console.log('Partial response detected for download. Total:', totalSize, 'Chunk:', contentLength);
        }
      }

      // If server returns partial content, fetch in chunks
      if (contentRange && contentLength && parseInt(contentLength) < totalSize) {
        console.log('Server returned partial content. Downloading in chunks...');
        const blob = await this.downloadInChunks(item, apiKey, totalSize, abortController.signal);

        await db.cachedTracks.put({
          id: item.trackId,
          channelId: item.channelId,
          channelName: item.channelName,
          fileName: item.fileName,
          fileSize: blob.size,
          streamUrl: item.streamUrl,
          cachedAt: new Date(),
          blob
        });

        await db.downloadQueue.delete(item.id!);
        console.log('Download completed (chunked):', item.fileName, 'Size:', blob.size);
        useDownloadStore.getState().markCompleted(item.trackId);
        return;
      }

      // Normal download (server returned full file)
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

        // Update progress
        const progress = totalSize > 0 ? Math.round((receivedLength / totalSize) * 100) : 0;
        await db.downloadQueue.update(item.id!, { progress });
        useDownloadStore.getState().setProgress(item.trackId, progress);
      }

      // Create blob and save to cache
      const blob = new Blob(chunks, { type: 'audio/mpeg' });

      console.log('Download stats:', {
        fileName: item.fileName,
        expectedSize: totalSize,
        actualSize: blob.size,
        receivedLength,
        complete: blob.size >= totalSize * 0.99
      });

      // Verify download is complete
      if (totalSize > 0 && blob.size < totalSize * 0.9) {
        throw new Error(`Incomplete download: got ${blob.size} bytes, expected ${totalSize}`);
      }

      await db.cachedTracks.put({
        id: item.trackId,
        channelId: item.channelId,
        channelName: item.channelName,
        fileName: item.fileName,
        fileSize: blob.size,
        streamUrl: item.streamUrl,
        cachedAt: new Date(),
        blob
      });

      // Remove from queue (track is now in cache)
      await db.downloadQueue.delete(item.id!);
      console.log('Download completed:', item.fileName, 'Size:', blob.size);

      useDownloadStore.getState().markCompleted(item.trackId);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        await db.downloadQueue.update(item.id!, { status: 'cancelled' });
      } else {
        console.error('Download failed:', error);
        await db.downloadQueue.update(item.id!, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      }
      // For failed/cancelled, just remove from active (don't mark as completed)
      const newMap = new Map(useDownloadStore.getState().activeDownloads);
      newMap.delete(item.trackId);
      useDownloadStore.setState({ activeDownloads: newMap });
    } finally {
      this.abortControllers.delete(item.trackId);
    }
  }

  // Cancel a download
  async cancelDownload(trackId: string): Promise<void> {
    const controller = this.abortControllers.get(trackId);
    if (controller) {
      controller.abort();
    }

    // Also mark pending items as cancelled
    const items = await db.downloadQueue
      .where('trackId')
      .equals(trackId)
      .toArray();

    for (const item of items) {
      if (item.status === 'pending' || item.status === 'downloading') {
        await db.downloadQueue.update(item.id!, { status: 'cancelled' });
      }
    }
  }

  // Cancel all downloads
  async cancelAll(): Promise<void> {
    // Abort active downloads
    for (const controller of this.abortControllers.values()) {
      controller.abort();
    }
    this.abortControllers.clear();

    // Mark all pending/downloading as cancelled
    const items = await db.downloadQueue
      .where('status')
      .anyOf(['pending', 'downloading'])
      .toArray();

    for (const item of items) {
      await db.downloadQueue.update(item.id!, { status: 'cancelled' });
    }
  }

  // Retry a failed download
  async retryDownload(trackId: string): Promise<void> {
    const item = await db.downloadQueue
      .where('trackId')
      .equals(trackId)
      .first();

    if (item && item.status === 'failed') {
      await db.downloadQueue.update(item.id!, {
        status: 'pending',
        progress: 0,
        errorMessage: undefined
      });
      this.processQueue();
    }
  }

  // Get queue status
  async getQueueStatus(): Promise<{
    pending: number;
    downloading: number;
    completed: number;
    failed: number;
  }> {
    const items = await db.downloadQueue.toArray();

    return {
      pending: items.filter(i => i.status === 'pending').length,
      downloading: items.filter(i => i.status === 'downloading').length,
      completed: items.filter(i => i.status === 'completed').length,
      failed: items.filter(i => i.status === 'failed').length
    };
  }

  // Clear completed downloads from queue
  async clearCompleted(): Promise<void> {
    await db.downloadQueue.where('status').equals('completed').delete();
  }

  // Clear all downloads from queue
  async clearQueue(): Promise<void> {
    await this.cancelAll();
    await db.downloadQueue.clear();
  }
}

export const downloadManager = new DownloadManager();
