import { playlistsApi } from '@/services/api/playlists.api';
import { downloadManager } from '@/services/download/DownloadManager';
import { cacheService } from '@/services/cache/CacheService';
import { isPlaylistOffline } from '@/db/database';
import { useUiStore } from '@/stores/uiStore';
import { queryClient, queryKeys } from '@/services/query/queryClient';
import type { Track } from '@/types/models';

export interface AddToPlaylistResult {
  added: number;
  duplicates: number;
  failed: number;
}

/**
 * Adds tracks to a playlist and tells the user how it went. Shared by the
 * playlist picker and desktop drag and drop so both behave the same: offline
 * playlists also queue the new tracks for download.
 */
export async function addTracksToPlaylist(
  playlistId: string,
  playlistName: string,
  tracks: Track[],
  onProgress?: (done: number, total: number) => void
): Promise<AddToPlaylistResult> {
  const result = await playlistsApi.addTracks(playlistId, tracks, onProgress);

  const parts: string[] = [];
  if (result.added > 0) parts.push(`${result.added} track${result.added === 1 ? '' : 's'} added`);
  if (result.duplicates > 0) parts.push(`${result.duplicates} already there`);
  if (result.failed > 0) parts.push(`${result.failed} failed`);

  // Offline playlists pull in the audio too
  if (result.added > 0 && (await isPlaylistOffline(playlistId))) {
    const cached = await cacheService.getCachedTrackIds(tracks.map((t) => t.fileId));
    const missing = tracks.filter((t) => !cached.has(t.fileId));
    if (missing.length > 0) {
      await downloadManager.addMultipleToQueue(missing);
      parts.push(`${missing.length} queued for download`);
    }
  }

  // Track counts in the sidebar and lists are now stale
  if (result.added > 0) queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });

  const summary = parts.length > 0 ? parts.join(', ') : 'Nothing to add';
  const tone = result.added > 0 ? 'success' : result.failed > 0 ? 'error' : 'info';
  useUiStore.getState().addToast(`${playlistName}: ${summary}`, tone);
  return result;
}
