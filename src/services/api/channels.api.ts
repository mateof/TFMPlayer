import { apiClient } from './client';
import { getV1Api } from './v1';
import { serverCapabilities } from '@/services/server/capabilities';
import { apiFileToChannelFile } from '@/services/files/fileManager';
import type {
  Channel,
  ChannelDetail,
  ChannelFile,
  ChannelFolder,
  ApiResult,
  ChannelStats,
  ChannelRefreshOptions,
  ChannelRefreshResult,
  ChannelRefreshProgress
} from '@/types/models';

// The v1 API wraps every payload in { success, data, error, message }
interface V1Result<T> {
  success: boolean;
  data: T;
  message?: string;
  error?: { code: string; message: string } | null;
}

export const channelsApi = {
  async getAll(): Promise<Channel[]> {
    const client = await apiClient.getClient();
    const { data } = await client.get<ApiResult<Channel[]>>('/api/mobile/channels');
    return data.data;
  },

  async getFavorites(): Promise<Channel[]> {
    const client = await apiClient.getClient();
    const { data } = await client.get<ApiResult<Channel[]>>('/api/mobile/channels/favorites');
    return data.data;
  },

  async getFolders(): Promise<{ folders: ChannelFolder[]; ungroupedChannels: Channel[] }> {
    const client = await apiClient.getClient();
    const { data } = await client.get<ApiResult<{ folders: ChannelFolder[]; ungroupedChannels: Channel[] }>>('/api/mobile/channels/folders');
    return data.data;
  },

  async getInfo(id: number): Promise<ChannelDetail> {
    const client = await apiClient.getClient();
    const { data } = await client.get<ApiResult<ChannelDetail>>(`/api/mobile/channels/${id}/info`);
    return data.data;
  },

  async getFiles(id: number, folderId?: string, params?: {
    page?: number;
    pageSize?: number;
    filter?: string;
    search?: string;
    sortBy?: string;
    sortDesc?: boolean;
  }): Promise<{ files: ChannelFile[]; totalCount: number; hasMore: boolean }> {
    // v1 servers: same listing (its 'audio' filter keeps the folders, like
    // the mobile 'audio_folders'), and entries carry the v1 media URLs
    if (await serverCapabilities.has('files.content')) {
      const v1 = await getV1Api();
      const { contents, page } = await v1.files.list(String(id), {
        folderId: folderId || undefined,
        path: folderId ? undefined : '/',
        filter: 'audio',
        search: params?.search || undefined,
        page: params?.page,
        pageSize: params?.pageSize,
        sortBy: params?.sortBy,
        sortDescending: params?.sortDesc
      });
      return {
        files: (contents?.items ?? []).map((dto) => apiFileToChannelFile(dto, 'channel')),
        totalCount: page.totalItems,
        hasMore: page.hasNext
      };
    }

    const client = await apiClient.getClient();
    const { data } = await client.get<ApiResult<ChannelFile[]> & { pagination?: { totalItems: number; hasNext: boolean } }>(`/api/mobile/channels/${id}/files`, {
      params: {
        folderId: folderId || undefined,
        filter: params?.filter,
        searchText: params?.search,
        page: params?.page,
        pageSize: params?.pageSize,
        sortBy: params?.sortBy,
        sortDescending: params?.sortDesc // Backend expects SortDescending
      }
    });
    // Extract totalCount from pagination.totalItems if available
    const totalCount = data.pagination?.totalItems || data.totalCount || data.data.length;
    const hasMore = data.pagination?.hasNext ?? (data.data.length >= (params?.pageSize || 50));
    return { files: data.data, totalCount, hasMore };
  },

  async addToFavorites(id: number): Promise<void> {
    const client = await apiClient.getClient();
    await client.post(`/api/mobile/channels/${id}/favorite`);
  },

  async removeFromFavorites(id: number): Promise<void> {
    const client = await apiClient.getClient();
    await client.delete(`/api/mobile/channels/${id}/favorite`);
  },

  // ---- v1 API: statistics and index refresh -------------------------------

  async getStats(id: number | string): Promise<ChannelStats> {
    const client = await apiClient.getClient();
    const { data } = await client.get<V1Result<ChannelStats>>(`/api/v1/channels/${id}`);
    return data.data;
  },

  /**
   * Starts a background scan of the channel on Telegram. Audio is always
   * indexed; video, documents and photos only when asked for.
   * Resolves to false when the server says a scan is already running (409).
   */
  async startRefresh(id: number | string, options: ChannelRefreshOptions): Promise<boolean> {
    const client = await apiClient.getClient();
    try {
      await client.post(`/api/v1/channels/${id}/refresh`, {
        includeAudio: true,
        includeVideo: options.includeVideo,
        includeDocuments: options.includeDocuments,
        includePhotos: options.includePhotos,
        force: options.force
      });
      return true;
    } catch (error) {
      const status = (error as { response?: { status?: number } }).response?.status;
      if (status === 409) return false;
      throw error;
    }
  },

  async isRefreshing(id: number | string): Promise<boolean> {
    const client = await apiClient.getClient();
    const { data } = await client.get<V1Result<boolean>>(`/api/v1/channels/${id}/refresh`);
    return !!data.data;
  },

  /** Live progress of a running scan (servers with `channels.refreshProgress`). */
  async getRefreshProgress(id: number | string): Promise<ChannelRefreshProgress | null> {
    const client = await apiClient.getClient();
    const { data } = await client.get<V1Result<ChannelRefreshProgress | null>>(`/api/v1/channels/${id}/refresh/progress`);
    return data.data ?? null;
  },

  /** Ask the server to stop a running scan. False when nothing was running (404). */
  async cancelRefresh(id: number | string): Promise<boolean> {
    const client = await apiClient.getClient();
    try {
      await client.delete(`/api/v1/channels/${id}/refresh`);
      return true;
    } catch (error) {
      if ((error as { response?: { status?: number } }).response?.status === 404) return false;
      throw error;
    }
  },

  /** Summary of the last finished scan; null when none ran since the server started. */
  async getRefreshResult(id: number | string): Promise<ChannelRefreshResult | null> {
    const client = await apiClient.getClient();
    const { data } = await client.get<V1Result<ChannelRefreshResult | null>>(`/api/v1/channels/${id}/refresh/result`);
    return data.data ?? null;
  }
};
