import { playlistsApi } from '@/services/api/playlists.api';
import { downloadManager } from '@/services/download/DownloadManager';
import { cacheService } from '@/services/cache/CacheService';
import { isPlaylistOffline } from '@/db/database';
import { useUiStore } from '@/stores/uiStore';
import { queryClient, queryKeys } from '@/services/query/queryClient';
import { t } from '@/i18n';
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
  if (result.added > 0) parts.push(result.added === 1 ? t('1 track added') : t('{count} tracks added', { count: result.added }));
  if (result.duplicates > 0) parts.push(t('{count} already there', { count: result.duplicates }));
  if (result.failed > 0) parts.push(t('{count} failed', { count: result.failed }));

  // Offline playlists pull in the audio too
  if (result.added > 0 && (await isPlaylistOffline(playlistId))) {
    const cached = await cacheService.getCachedTrackIds(tracks.map((tr) => tr.fileId));
    const missing = tracks.filter((tr) => !cached.has(tr.fileId));
    if (missing.length > 0) {
      await downloadManager.addMultipleToQueue(missing);
      parts.push(t('{count} queued for download', { count: missing.length }));
    }
  }

  // Track counts in the sidebar and lists are now stale
  if (result.added > 0) queryClient.invalidateQueries({ queryKey: queryKeys.playlists.all });

  const summary = parts.length > 0 ? parts.join(', ') : t('Nothing to add');
  const tone = result.added > 0 ? 'success' : result.failed > 0 ? 'error' : 'info';
  useUiStore.getState().addToast(t('{name}: {summary}', { name: playlistName, summary }), tone);
  return result;
}
