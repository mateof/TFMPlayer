import { isAxiosError } from 'axios';
import { apiClient, buildStreamUrlSync, buildLocalStreamUrlSync } from './client';
import type {
  Playlist,
  PlaylistDetail,
  ApiResult,
  CreatePlaylistRequest,
  UpdatePlaylistRequest,
  AddTrackRequest,
  Track
} from '@/types/models';

// Ensure track has a valid streamUrl
function ensureStreamUrl(track: Track): Track {
  // Check if it's a local file - either by flag or by channelId
  const isLocal = track.isLocalFile || track.channelId === 'local';

  // For local files, we need a valid filePath
  // The filePath might be in filePath field or in fileId field (depending on how server stores it)
  const localPath = track.filePath || (isLocal ? track.fileId : null);

  if (!track.streamUrl || !track.streamUrl.startsWith('http')) {
    if (isLocal && localPath) {
      return {
        ...track,
        isLocalFile: true,
        streamUrl: buildLocalStreamUrlSync(localPath)
      };
    }
    // Otherwise build channel stream URL
    return {
      ...track,
      streamUrl: buildStreamUrlSync(track.channelId, track.fileId, track.fileName)
    };
  }

  // Even if streamUrl exists, check if it's using the wrong endpoint for local files
  if (isLocal && localPath && track.streamUrl.includes('/stream/tfm/')) {
    return {
      ...track,
      isLocalFile: true,
      streamUrl: buildLocalStreamUrlSync(localPath)
    };
  }

  return track;
}

export const playlistsApi = {
  async getAll(): Promise<Playlist[]> {
    const client = await apiClient.getClient();
    const { data } = await client.get<ApiResult<Playlist[]>>('/api/mobile/playlists');
    return data.data;
  },

  async getById(id: string): Promise<PlaylistDetail> {
    const client = await apiClient.getClient();
    const { data } = await client.get<ApiResult<PlaylistDetail>>(`/api/mobile/playlists/${id}`);

    // Ensure all tracks have valid streamUrls
    const playlist = data.data;
    if (playlist.tracks) {
      playlist.tracks = playlist.tracks.map(ensureStreamUrl);
    }

    return playlist;
  },

  async create(request: CreatePlaylistRequest): Promise<Playlist> {
    const client = await apiClient.getClient();
    const { data } = await client.post<ApiResult<Playlist>>('/api/mobile/playlists', request);
    return data.data;
  },

  async update(id: string, request: UpdatePlaylistRequest): Promise<Playlist> {
    const client = await apiClient.getClient();
    const { data } = await client.put<ApiResult<Playlist>>(`/api/mobile/playlists/${id}`, request);
    return data.data;
  },

  async delete(id: string): Promise<void> {
    const client = await apiClient.getClient();
    await client.delete(`/api/mobile/playlists/${id}`);
  },

  async addTrack(playlistId: string, track: AddTrackRequest): Promise<void> {
    const client = await apiClient.getClient();
    await client.post(`/api/mobile/playlists/${playlistId}/tracks`, track);
  },

  // Add many tracks in one go. The server has no bulk endpoint, so they go
  // one by one; a 409 means the track was already there, which is a skip
  // rather than a failure.
  async addTracks(
    playlistId: string,
    tracks: AddTrackRequest[],
    onProgress?: (done: number, total: number) => void
  ): Promise<{ added: number; duplicates: number; failed: number }> {
    const client = await apiClient.getClient();
    let added = 0;
    let duplicates = 0;
    let failed = 0;

    for (let i = 0; i < tracks.length; i++) {
      try {
        await client.post(`/api/mobile/playlists/${playlistId}/tracks`, tracks[i]);
        added++;
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 409) {
          duplicates++;
        } else {
          failed++;
          console.warn('Failed to add track to playlist:', error);
        }
      }
      onProgress?.(i + 1, tracks.length);
    }

    return { added, duplicates, failed };
  },

  async removeTrack(playlistId: string, fileId: string): Promise<void> {
    const client = await apiClient.getClient();
    await client.delete(`/api/mobile/playlists/${playlistId}/tracks/${fileId}`);
  },

  async reorderTracks(playlistId: string, trackIds: string[]): Promise<void> {
    const client = await apiClient.getClient();
    await client.put(`/api/mobile/playlists/${playlistId}/tracks/reorder`, { OrderedFileIds: trackIds });
  }
};
