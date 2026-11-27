import { apiClient } from './client';
import { getV1Api } from './v1';
import { serverCapabilities } from '@/services/server/capabilities';
import { apiFileToChannelFile, toLocalV1Path } from '@/services/files/fileManager';
import type { ChannelFile } from '@/types/models';

interface LocalListing {
  files: ChannelFile[];
  totalCount: number;
  currentPath: string;
  parentPath: string | null;
  hasMore: boolean;
}

export const localFilesApi = {
  async getFiles(path: string = '', params?: {
    page?: number;
    pageSize?: number;
    filter?: string;
    search?: string;
    sortBy?: string;
    sortDesc?: boolean;
  }): Promise<LocalListing> {
    // v1 servers: the same listing through /api/v1/local (folders are kept by its
    // 'audio' filter, as with the mobile 'audio_folders'), with ids written as
    // the mobile API does ('/music/a.mp3') so downloads and playlists still match
    if (await serverCapabilities.has('files.content')) {
      const v1 = await getV1Api();
      const { contents, page } = await v1.local.list({
        path: toLocalV1Path(path) || undefined,
        filter: 'audio',
        search: params?.search || undefined,
        page: params?.page,
        pageSize: params?.pageSize,
        sortBy: params?.sortBy,
        sortDescending: params?.sortDesc
      });
      return {
        files: (contents?.items ?? []).map((dto) => apiFileToChannelFile(dto, 'local')),
        totalCount: page.totalItems,
        currentPath: contents?.currentPath ? `/${toLocalV1Path(contents.currentPath)}` : path,
        parentPath: contents?.parentPath != null ? `/${toLocalV1Path(contents.parentPath)}` : null,
        hasMore: page.hasNext
      };
    }

    const client = await apiClient.getClient();

    // Ensure path starts with / for the API (uses capital P for Path parameter)
    const normalizedPath = path ? (path.startsWith('/') ? path : `/${path}`) : undefined;

    const { data } = await client.get<{
      data?: { items?: ChannelFile[]; totalItems?: number; currentPath?: string; parentPath?: string | null } | null;
      pagination?: { totalItems?: number; hasNext?: boolean };
    }>('/api/mobile/files/local', {
      params: {
        Path: normalizedPath, // Capital P as expected by the API
        filter: params?.filter,
        searchText: params?.search,
        page: params?.page,
        pageSize: params?.pageSize,
        sortBy: params?.sortBy,
        sortDescending: params?.sortDesc // Backend expects SortDescending
      }
    });

    // ApiResponse<FolderContentsDto> plus the pagination block
    const contents = data?.data ?? {};
    const files = Array.isArray(contents.items) ? contents.items : [];
    return {
      files,
      totalCount: data?.pagination?.totalItems ?? contents.totalItems ?? files.length,
      currentPath: contents.currentPath || path,
      parentPath: contents.parentPath ?? null,
      hasMore: data?.pagination?.hasNext ?? files.length >= (params?.pageSize ?? 50)
    };
  }
};