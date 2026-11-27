import { db, type DownloadQueueEntity } from '@/db/database';
import { cacheService } from '@/services/cache/CacheService';
import {
  apiClient,
  buildTranscodedUrlSync,
  buildLocalTranscodedUrlSync,
  buildV1TranscodedUrlSync,
  buildV1LocalTranscodedUrlSync
} from '@/services/api/client';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';
import type { Track } from '@/types/models';
import { create } from 'zustand';
import { readBlobTags } from '@/utils/audioTags';
import { serverCapabilities } from '@/services/server/capabilities';
import { log } from '@/utils/logger';
import { t } from '@/i18n';

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

  // Surface a failed transcode in the UI, but only once per session so a
  // 200-track playlist doesn't produce 200 toasts
  private transcodeWarningShown = false;

  private warnTranscodeUnavailable(status: number): void {
    if (this.transcodeWarningShown) return;
    this.transcodeWarningShown = true;

    const reason = status === 501
      ? t('the server has no FFmpeg')
      : status === 404
        ? t('the server does not support it for this source')
        : t('the server answered {status}', { status });
    useUiStore.getState().addToast(
      t('Downloading in original format: transcoding failed because {reason}', { reason }),
      'warning'
    );
  }

  // Recover the local-directory path from a /stream/local?path=... URL
  private extractLocalPath(streamUrl: string): string | undefined {
    const query = streamUrl.split('?')[1];
    if (!query) return undefined;
    return new URLSearchParams(query).get('path') ?? undefined;
  }

  // Add track to download queue. `force` re-downloads a track that is already
  // cached (used to re-fetch in a newly configured format); the existing blob
  // is kept until the new one replaces it.
  async addToQueue(track: Track, force = false): Promise<void> {
    if (!force) {
      const isCached = await cacheService.isTrackCached(track.fileId);
      if (isCached) {
        log.debug('Track already cached:', track.fileName);
        return;
      }
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
        filePath: track.filePath,
        errorMessage: undefined
      });
      log.debug('Track reset in queue:', track.fileName);

      // Start processing if not already
      this.processQueue();
      return;
    }

    // Add new to queue
    const queueItem: Omit<DownloadQueueEntity, 'id'> = {
      trackId: track.fileId,
      streamUrl: track.streamUrl,
      fileName: track.fileName,
      filePath: track.filePath,
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

  // Add multiple tracks to queue. Bulk version of addToQueue: one cache
  // lookup, one queue lookup and one write transaction for the whole batch
  // (a 2000-track folder used to cost thousands of IndexedDB round trips).
  async addMultipleToQueue(tracks: Track[], force = false): Promise<void> {
    if (tracks.length === 0) return;

    // Same track twice in the batch: keep the first
    const unique = new Map<string, Track>();
    for (const track of tracks) {
      if (!unique.has(track.fileId)) unique.set(track.fileId, track);
    }

    const ids = [...unique.keys()];
    const cached = force ? new Set<string>() : await cacheService.getCachedTrackIds(ids);
    const wanted = ids.filter((id) => !cached.has(id)).map((id) => unique.get(id)!);
    if (wanted.length === 0) return;

    await db.transaction('rw', db.downloadQueue, async () => {
      const existing = await db.downloadQueue
        .where('trackId')
        .anyOf(wanted.map((track) => track.fileId))
        .toArray();
      const existingByTrack = new Map(existing.map((item) => [item.trackId, item]));

      const updates: DownloadQueueEntity[] = [];
      const additions: Omit<DownloadQueueEntity, 'id'>[] = [];
      for (const track of wanted) {
        const item = existingByTrack.get(track.fileId);
        if (item) {
          // Reset and refresh the URL in case it changed (http -> https)
          updates.push({
            ...item,
            status: 'pending',
            progress: 0,
            streamUrl: track.streamUrl,
            filePath: track.filePath,
            errorMessage: undefined
          });
        } else {
          additions.push({
            trackId: track.fileId,
            streamUrl: track.streamUrl,
            fileName: track.fileName,
            filePath: track.filePath,
            channelId: track.channelId,
            channelName: track.channelName,
            fileSize: track.fileSize,
            status: 'pending',
            progress: 0,
            addedAt: new Date()
          });
        }
      }
      if (updates.length > 0) await db.downloadQueue.bulkPut(updates);
      if (additions.length > 0) await db.downloadQueue.bulkAdd(additions as DownloadQueueEntity[]);
    });

    log.debug(`Queued ${wanted.length} of ${tracks.length} tracks for download`);
    if (!this.isProcessing) {
      this.processQueue();
    }
  }

  // Process the download queue
  async processQueue(): Promise<void> {
    if (this.isProcessing) {
      log.debug('Download queue already processing');
      return;
    }

    this.isProcessing = true;
    useDownloadStore.getState().setProcessing(true);
    log.debug('Starting download queue processing...');

    try {
      let processedCount = 0;
      while (true) {
        // Get next pending item
        const item = await db.downloadQueue
          .where('status')
          .equals('pending')
          .first();

        if (!item) {
          log.debug(`Queue processing complete. Processed ${processedCount} items.`);
          break;
        }

        log.debug(`Processing download: ${item.fileName}`);
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
    log.debug('Force restarting download queue...');
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
    downloadUrl: string,
    apiKey: string,
    totalSize: number,
    signal: AbortSignal,
    blobType: string
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

      log.debug(`Downloading chunk: ${rangeHeader}`);

      const response = await fetch(downloadUrl, {
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

      log.debug(`Downloaded ${downloaded} / ${totalSize} bytes (${progress}%)`);
    }

    return new Blob(chunks, { type: blobType });
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

      // Offline format setting: download transcoded (MP3/AAC) instead of the
      // original when configured and the file isn't already in that format.
      // Channel files and local files have separate transcoding endpoints.
      const { downloadFormat, downloadBitrate } = useSettingsStore.getState();
      const extension = item.fileName.split('.').pop()?.toLowerCase() ?? '';
      const alreadyTargetFormat =
        extension === downloadFormat ||
        (downloadFormat === 'aac' && (extension === 'aac' || extension === 'm4a'));

      const isChannelFile = item.streamUrl.includes('/stream/tfm/');
      const isLocalFile = item.streamUrl.includes('/stream/local');
      // Items queued before filePath was stored still carry it in the URL
      const localPath = item.filePath ?? this.extractLocalPath(item.streamUrl);

      // Local files can only be transcoded by servers that say so (older ones
      // answered 404 and we found out by failing). Servers with v1 transcoding
      // (audio.transcode) get the v1 endpoints.
      const caps = await serverCapabilities.get();
      const v1Transcode = caps.features.has('audio.transcode');
      const canTranscodeLocal = v1Transcode || caps.features.has('stream.localTranscode');
      let transcoded =
        downloadFormat !== 'original' &&
        !alreadyTargetFormat &&
        (isChannelFile || (isLocalFile && !!localPath && canTranscodeLocal));

      let downloadUrl = item.streamUrl;
      if (transcoded) {
        downloadUrl = isChannelFile
          ? v1Transcode
            ? buildV1TranscodedUrlSync(item.channelId, item.trackId, downloadFormat, downloadBitrate)
            : buildTranscodedUrlSync(item.channelId, item.trackId, downloadFormat, downloadBitrate, item.fileName)
          : v1Transcode
            ? buildV1LocalTranscodedUrlSync(localPath!, downloadFormat, downloadBitrate)
            : buildLocalTranscodedUrlSync(localPath!, downloadFormat, downloadBitrate);
      }

      // First request to check file size and if server returns partial content
      let response = await fetch(downloadUrl, {
        signal: abortController.signal,
        headers: {
          'X-API-Key': apiKey,
          'Range': 'bytes=0-' // Request full file
        }
      });

      // Transcoding unavailable (e.g. no FFmpeg on the server): fall back to
      // original. Tell the user once per session — silently downloading a
      // different format than the one configured is impossible to notice.
      if (!response.ok && response.status !== 206 && transcoded) {
        console.warn(`Transcoded download failed (HTTP ${response.status}), falling back to original format`);
        this.warnTranscodeUnavailable(response.status);
        transcoded = false;
        downloadUrl = item.streamUrl;
        response = await fetch(downloadUrl, {
          signal: abortController.signal,
          headers: {
            'X-API-Key': apiKey,
            'Range': 'bytes=0-'
          }
        });
      }

      if (!response.ok && response.status !== 206) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const blobType = transcoded
        ? (downloadFormat === 'mp3' ? 'audio/mpeg' : 'audio/mp4')
        : 'audio/mpeg';

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
          log.debug('Partial response detected for download. Total:', totalSize, 'Chunk:', contentLength);
        }
      }

      // If server returns partial content, fetch in chunks
      if (contentRange && contentLength && parseInt(contentLength) < totalSize) {
        log.debug('Server returned partial content. Downloading in chunks...');
        const blob = await this.downloadInChunks(
          item, downloadUrl, apiKey, totalSize, abortController.signal, blobType
        );

        // Extract metadata from the downloaded file
        log.debug('Extracting metadata for:', item.fileName);
        const metadata = await readBlobTags(blob);

        await db.cachedTracks.put({
          id: item.trackId,
          channelId: item.channelId,
          channelName: item.channelName,
          fileName: item.fileName,
          fileSize: blob.size,
          streamUrl: item.streamUrl,
          cachedAt: new Date(),
          blob,
          title: metadata.title,
          artist: metadata.artist,
          album: metadata.album,
          duration: metadata.duration,
          coverArt: metadata.coverArt,
          metadataExtracted: true,
          audioFormat: metadata.audioFormat,
          audioBitrate: metadata.audioBitrate,
          replayGainDb: metadata.replayGainDb,
          replayGainPeak: metadata.replayGainPeak
        });

        await db.downloadQueue.delete(item.id!);
        log.debug('Download completed (chunked):', item.fileName, 'Size:', blob.size, 'Metadata:', metadata.title || 'none');
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
      const blob = new Blob(chunks, { type: blobType });

      log.debug('Download stats:', {
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

      // Extract metadata from the downloaded file
      log.debug('Extracting metadata for:', item.fileName);
      const metadata = await readBlobTags(blob);

      await db.cachedTracks.put({
        id: item.trackId,
        channelId: item.channelId,
        channelName: item.channelName,
        fileName: item.fileName,
        fileSize: blob.size,
        streamUrl: item.streamUrl,
        cachedAt: new Date(),
        blob,
        title: metadata.title,
        artist: metadata.artist,
        album: metadata.album,
        duration: metadata.duration,
        coverArt: metadata.coverArt,
        audioFormat: metadata.audioFormat,
        audioBitrate: metadata.audioBitrate,
        replayGainDb: metadata.replayGainDb,
        replayGainPeak: metadata.replayGainPeak,
        metadataExtracted: true
      });

      // Remove from queue (track is now in cache)
      await db.downloadQueue.delete(item.id!);
      log.debug('Download completed:', item.fileName, 'Size:', blob.size, 'Metadata:', metadata.title || 'none');

      useDownloadStore.getState().markCompleted(item.trackId);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        await db.downloadQueue.update(item.id!, { status: 'cancelled' });
      } else {
        console.error('Download failed:', error);
        await db.downloadQueue.update(item.id!, {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : t('Unknown error')
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

  // Analyze existing cached tracks that don't have metadata extracted.
  // Also picks up tracks analyzed before audioFormat was recorded, so an
  // existing library can be checked for what it actually holds.
  async analyzeExistingTracks(onProgress?: (current: number, total: number) => void): Promise<number> {
    const tracksToAnalyze = await db.cachedTracks
      .filter(track => !track.metadataExtracted || !track.audioFormat)
      .toArray();

    if (tracksToAnalyze.length === 0) {
      log.debug('All tracks already have metadata extracted');
      return 0;
    }

    log.debug(`Analyzing ${tracksToAnalyze.length} tracks for metadata...`);
    let analyzedCount = 0;

    for (const track of tracksToAnalyze) {
      try {
        if (!track.blob) {
          console.warn(`Track ${track.fileName} has no blob, skipping`);
          continue;
        }

        const metadata = await readBlobTags(track.blob);

        // Update the track with extracted metadata
        await db.cachedTracks.update(track.id, {
          title: metadata.title || track.title,
          artist: metadata.artist || track.artist,
          album: metadata.album || track.album,
          duration: metadata.duration || track.duration,
          coverArt: metadata.coverArt || track.coverArt,
          metadataExtracted: true,
          audioFormat: metadata.audioFormat || track.audioFormat,
          audioBitrate: metadata.audioBitrate || track.audioBitrate,
          replayGainDb: metadata.replayGainDb ?? track.replayGainDb,
          replayGainPeak: metadata.replayGainPeak ?? track.replayGainPeak
        });

        analyzedCount++;
        log.debug(`Analyzed: ${track.fileName} -> ${metadata.title || 'no title'}`);

        if (onProgress) {
          onProgress(analyzedCount, tracksToAnalyze.length);
        }
      } catch (error) {
        console.error(`Failed to analyze track ${track.fileName}:`, error);
        // Mark as analyzed even if failed, to avoid infinite retries
        await db.cachedTracks.update(track.id, { metadataExtracted: true });
      }
    }

    log.debug(`Metadata analysis complete. Analyzed ${analyzedCount} tracks.`);
    return analyzedCount;
  }

  // Get count of tracks pending analysis
  async getPendingAnalysisCount(): Promise<number> {
    return db.cachedTracks
      .filter(track => !track.metadataExtracted || !track.audioFormat)
      .count();
  }
}

export const downloadManager = new DownloadManager();
