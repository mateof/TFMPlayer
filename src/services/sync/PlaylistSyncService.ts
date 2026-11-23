import { getAllOfflinePlaylists, saveOfflinePlaylist } from '@/db/database';
import { playlistsApi } from '@/services/api/playlists.api';
import { downloadManager } from '@/services/download/DownloadManager';
import { cacheService } from '@/services/cache/CacheService';
import type { Track } from '@/types/models';
import { log } from '@/utils/logger';

const SYNC_INTERVAL = 2 * 60 * 1000; // 2 minutes

class PlaylistSyncService {
  private intervalId: number | null = null;
  private isSyncing = false;
  private lastSyncTime = 0;

  // Start the sync service
  start(): void {
    if (this.intervalId) return;

    log.debug('[PlaylistSync] Starting sync service...');

    // Run initial sync after a short delay
    setTimeout(() => this.syncOfflinePlaylists(), 5000);

    // Set up periodic sync
    this.intervalId = window.setInterval(() => {
      this.syncOfflinePlaylists();
    }, SYNC_INTERVAL);
  }

  // Stop the sync service
  stop(): void {
    if (this.intervalId) {
      window.clearInterval(this.intervalId);
      this.intervalId = null;
      log.debug('[PlaylistSync] Sync service stopped');
    }
  }

  // Manually trigger sync
  async triggerSync(): Promise<void> {
    await this.syncOfflinePlaylists();
  }

  // Sync all offline playlists with autoSync enabled
  private async syncOfflinePlaylists(): Promise<void> {
    if (this.isSyncing) {
      log.debug('[PlaylistSync] Sync already in progress, skipping...');
      return;
    }

    // Cooldown check
    const now = Date.now();
    if (now - this.lastSyncTime < 30000) { // 30 second cooldown
      return;
    }

    this.isSyncing = true;
    this.lastSyncTime = now;

    try {
      const offlinePlaylists = await getAllOfflinePlaylists();
      const playlistsToSync = offlinePlaylists.filter(p => p.autoSync);

      if (playlistsToSync.length === 0) {
        return;
      }

      log.debug(`[PlaylistSync] Syncing ${playlistsToSync.length} offline playlists...`);

      for (const offlinePlaylist of playlistsToSync) {
        try {
          await this.syncPlaylist(offlinePlaylist.id, offlinePlaylist.tracksJson);
        } catch (error) {
          console.warn(`[PlaylistSync] Failed to sync playlist ${offlinePlaylist.name}:`, error);
        }
      }

      log.debug('[PlaylistSync] Sync complete');
    } catch (error) {
      console.error('[PlaylistSync] Error during sync:', error);
    } finally {
      this.isSyncing = false;
    }
  }

  // Sync a single playlist
  private async syncPlaylist(playlistId: string, localTracksJson: string): Promise<void> {
    // Fetch latest playlist from server
    const serverPlaylist = await playlistsApi.getById(playlistId);

    // Parse local tracks
    const localTracks: Track[] = JSON.parse(localTracksJson);
    const localTrackIds = new Set(localTracks.map(t => t.fileId));

    // Find new tracks that are on server but not in local
    const newTracks = serverPlaylist.tracks.filter(t => !localTrackIds.has(t.fileId));

    if (newTracks.length === 0) {
      return;
    }

    log.debug(`[PlaylistSync] Found ${newTracks.length} new tracks in playlist "${serverPlaylist.name}"`);

    // Update local offline playlist data
    await saveOfflinePlaylist(
      playlistId,
      serverPlaylist.name,
      serverPlaylist.description,
      serverPlaylist.tracks
    );

    // Queue new tracks for download (cached ones are skipped in bulk)
    await downloadManager.addMultipleToQueue(newTracks);
  }

  // Check for and download missing tracks in offline playlists
  async downloadMissingTracks(): Promise<number> {
    const offlinePlaylists = await getAllOfflinePlaylists();
    let totalMissing = 0;

    for (const playlist of offlinePlaylists) {
      const tracks: Track[] = JSON.parse(playlist.tracksJson);
      const cached = await cacheService.getCachedTrackIds(tracks.map((t) => t.fileId));
      const missing = tracks.filter((t) => !cached.has(t.fileId));
      if (missing.length > 0) {
        await downloadManager.addMultipleToQueue(missing);
        totalMissing += missing.length;
      }
    }

    if (totalMissing > 0) {
      log.debug(`[PlaylistSync] Queued ${totalMissing} missing tracks for download`);
    }

    return totalMissing;
  }
}

export const playlistSyncService = new PlaylistSyncService();
