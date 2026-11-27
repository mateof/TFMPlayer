// Mirrors ClientApp/packages/api-client/src/modules/search.ts of TelegramFileManager.
import type { HttpClient } from '../http';
import type { ApiFileDto, BrowseFilter } from '../types/files';

export interface GlobalSearchQuery {
  /** At least 2 characters, case-insensitive substring of the file name. */
  q: string;
  filter?: BrowseFilter;
  scope?: 'all' | 'channels' | 'local';
  /** 1-500 (default 200), applied to channel and local results separately. */
  limit?: number;
}

export interface ApiChannelSearchGroupDto {
  channelId: string;
  channelName: string;
  files: ApiFileDto[];
}

export interface ApiGlobalSearchDto {
  channels: ApiChannelSearchGroupDto[];
  local: ApiFileDto[];
  truncated: boolean;
}

/** Server-wide search (`search.v1`): `GET /api/v1/search`. */
export function createSearchApi(http: HttpClient) {
  return {
    global: (query: GlobalSearchQuery, signal?: AbortSignal) =>
      http.get<ApiGlobalSearchDto>('/api/v1/search', { query: { ...query }, signal })
  };
}
