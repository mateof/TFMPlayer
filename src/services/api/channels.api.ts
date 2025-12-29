import { apiClient } from './client';
import type { Channel, ChannelDetail, ChannelFile, ChannelFolder, ApiResult } from '@/types/models';

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
    const client = await apiClient.getClient();
    const { data } = await client.get<ApiResult<ChannelFile[]> & { pagination?: { totalItems: number; hasNext: boolean } }>(`/api/mobile/channels/${id}/files`, {
      params: {
        folderId: folderId || undefined,
        filter: params?.filter,
        searchText: params?.search,
        page: params?.page,
        pageSize: params?.pageSize,
        sortBy: params?.sortBy,
        sortDesc: params?.sortDesc
      }
    });
    // Extract totalCount from pagination.totalItems if available
    const totalCount = data.pagination?.totalItems || data.totalCount || data.data.length;
    const hasMore = data.pagination?.hasNext ?? (data.data.length >= (params?.pageSize || 50));
    return { files: data.data, totalCount, hasMore };
  },

  async browse(id: number, path: string = '/'): Promise<ChannelFile[]> {
    const client = await apiClient.getClient();
    const { data } = await client.get<ApiResult<ChannelFile[]>>(`/api/mobile/channels/${id}/browse`, {
      params: { path }
    });
    return data.data;
  },

  async addToFavorites(id: number): Promise<void> {
    const client = await apiClient.getClient();
    await client.post(`/api/mobile/channels/${id}/favorite`);
  },

  async removeFromFavorites(id: number): Promise<void> {
    const client = await apiClient.getClient();
    await client.delete(`/api/mobile/channels/${id}/favorite`);
  }
};
