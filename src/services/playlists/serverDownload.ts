import { getV1Api } from '@/services/api/v1';

/**
 * Asks the server to download a whole playlist into its local storage
 * (`POST /api/v1/playlists/{id}/download`, 202): channel tracks come from
 * Telegram, local ones are copied. Progress shows on the transfers screen.
 * Needs the v1 API (servers with `files.content`) and a Telegram session.
 */
export async function downloadPlaylistToServer(playlistId: string, destinationFolder?: string): Promise<void> {
  const v1 = await getV1Api();
  await v1.http.post<unknown>(`/api/v1/playlists/${encodeURIComponent(playlistId)}/download`, undefined, {
    query: { destinationFolder: destinationFolder?.trim() || undefined }
  });
}
