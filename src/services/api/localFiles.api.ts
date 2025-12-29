import { apiClient, buildBaseUrl } from './client';
import type { ChannelFile } from '@/types/models';

export const localFilesApi = {
  async getFiles(path: string = '', params?: {
    page?: number;
    pageSize?: number;
    filter?: string;
    search?: string;
    sortBy?: string;
    sortDesc?: boolean;
  }): Promise<{ files: ChannelFile[]; totalCount: number; currentPath: string; parentPath: string | null; hasMore: boolean }> {
    const client = await apiClient.getClient();

    // Ensure path starts with / for the API (uses capital P for Path parameter)
    const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : undefined;

    const response = await client.get('/api/mobile/files/local', {
      params: {
        Path: normalizedPath, // Capital P as expected by the API
        filter: params?.filter,
        searchText: params?.search,
        page: params?.page,
        pageSize: params?.pageSize,
        sortBy: params?.sortBy,
        sortDesc: params?.sortDesc
      }
    });

    const data = response.data;
    console.log('Local files API response:', data);

    // Handle different response structures
    let files: ChannelFile[] = [];
    let totalCount = 0;
    let currentPath = path;
    let parentPath: string | null = null;

    // If response has a data wrapper (ApiResult pattern)
    const innerData = data.data || data;

    // Extract files array - could be in different locations
    if (Array.isArray(innerData)) {
      files = innerData;
    } else if (innerData.files && Array.isArray(innerData.files)) {
      files = innerData.files;
    } else if (innerData.items && Array.isArray(innerData.items)) {
      files = innerData.items;
    }

    // Extract metadata - check for pagination object like in channels API
    const pagination = data.pagination || innerData.pagination;
    totalCount = pagination?.totalItems || data.totalCount || innerData.totalCount || files.length;
    const hasMore = pagination?.hasNext ?? (files.length >= 50);
    currentPath = innerData.currentPath || innerData.path || path;
    parentPath = innerData.parentPath || innerData.parent || null;

    return { files, totalCount, currentPath, parentPath, hasMore };
  },

  async getStreamUrl(filePath: string): Promise<string> {
    const baseUrl = await buildBaseUrl();
    return `${baseUrl}/api/mobile/stream/local?path=${encodeURIComponent(filePath)}`;
  }
};
