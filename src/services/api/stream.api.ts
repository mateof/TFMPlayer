import { apiClient } from './client';
import type { AudioInfo, ApiResult } from '@/types/models';

export const streamApi = {
  async getAudioInfo(channelId: string, fileId: string): Promise<AudioInfo> {
    const client = await apiClient.getClient();
    const { data } = await client.get<ApiResult<AudioInfo>>(`/api/mobile/stream/info/${channelId}/${fileId}`);
    return data.data;
  },

  async preload(channelId: string, fileId: string): Promise<void> {
    const client = await apiClient.getClient();
    await client.post(`/api/mobile/stream/preload/${channelId}/${fileId}`);
  },

  // Server transcoding capabilities (requires FFmpeg on the server)
  async getTranscodeInfo(): Promise<{ ffmpegAvailable: boolean; formats: string[] }> {
    const client = await apiClient.getClient();
    const { data } = await client.get<ApiResult<{ ffmpegAvailable: boolean; formats: string[] }>>(
      '/api/mobile/stream/transcode/info'
    );
    return data.data;
  }
};
