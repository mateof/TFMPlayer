import { apiClient, buildStreamUrlSync } from './client';
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
  if (!track.streamUrl || !track.streamUrl.startsWith('http')) {
    return {
      ...track,
      streamUrl: buildStreamUrlSync(track.channelId, track.fileId, track.fileName)
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

  async removeTrack(playlistId: string, fileId: string): Promise<void> {
    const client = await apiClient.getClient();
    await client.delete(`/api/mobile/playlists/${playlistId}/tracks/${fileId}`);
  },

  async reorderTracks(playlistId: string, trackIds: string[]): Promise<void> {
    const client = await apiClient.getClient();
    await client.put(`/api/mobile/playlists/${playlistId}/tracks/reorder`, { trackIds });
  }
};
