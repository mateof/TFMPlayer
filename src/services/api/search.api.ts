import { apiClient } from './client';
import { channelsApi } from './channels.api';
import { getV1Api } from './v1';
import { serverCapabilities } from '@/services/server/capabilities';
import { apiFileToChannelFile } from '@/services/files/fileManager';
import type { ChannelFile } from '@/types/models';

export type SearchScope = 'all' | 'channels' | 'local';

export interface ChannelSearchGroup {
  channelId: string;
  channelName: string;
  files: ChannelFile[];
}

export interface SearchResults {
  channels: ChannelSearchGroup[];
  local: ChannelFile[];
  truncated: boolean;
  /**
   * `server`: one global search on the server (GET /api/mobile/search).
   * `favorites`: older server, so only favourite channels were searched one by one.
   */
  mode: 'server' | 'favorites';
  /** Favourite channels that could not be searched (`favorites` mode). */
  failedChannels?: string[];
}

const SEARCH_LIMIT = 200;
// Older servers: how many favourite channels to search and how many at once
const FALLBACK_MAX_CHANNELS = 25;
const FALLBACK_CONCURRENCY = 4;
const FALLBACK_PER_CHANNEL = 50;

// Local file DTO of the mobile API (GET /api/mobile/files/local and search)
interface LocalFileDto {
  id: string;
  name: string;
  path: string;
  isFolder?: boolean;
  hasChildren?: boolean;
  size: number;
  type: string;
  category: ChannelFile['category'];
  dateCreated: string;
  dateModified: string;
  streamUrl?: string | null;
  downloadUrl?: string | null;
}

function localToChannelFile(dto: LocalFileDto): ChannelFile {
  return {
    id: dto.id,
    name: dto.name,
    path: dto.path,
    parentId: '',
    size: dto.size,
    type: dto.type,
    category: dto.isFolder ? 'Folder' : dto.category,
    dateCreated: dto.dateCreated,
    dateModified: dto.dateModified,
    isFile: !dto.isFolder,
    hasChildren: !!dto.hasChildren,
    streamUrl: dto.streamUrl ?? undefined,
    downloadUrl: dto.downloadUrl ?? undefined
  };
}

async function serverSearch(q: string, scope: SearchScope, signal?: AbortSignal): Promise<SearchResults> {
  const client = await apiClient.getClient();
  const { data } = await client.get<{
    data: { channels: ChannelSearchGroup[]; local: LocalFileDto[]; truncated: boolean };
  }>('/api/mobile/search', {
    params: { q, scope, filter: 'audio', limit: SEARCH_LIMIT },
    // Walks every channel index: give it longer than ordinary requests
    timeout: 30000,
    signal
  });
  return {
    channels: data.data.channels ?? [],
    local: (data.data.local ?? []).map(localToChannelFile),
    truncated: !!data.data.truncated,
    mode: 'server'
  };
}

/** Servers with `search.v1`: the same global search with v1 DTOs (media URLs included). */
async function v1Search(q: string, scope: SearchScope, signal?: AbortSignal): Promise<SearchResults> {
  const v1 = await getV1Api();
  const data = await v1.search.global({ q, scope, filter: 'audio', limit: SEARCH_LIMIT }, signal);
  return {
    channels: (data?.channels ?? []).map((group) => ({
      channelId: group.channelId,
      channelName: group.channelName,
      files: group.files.filter((f) => f.isFile).map((f) => apiFileToChannelFile(f, 'channel'))
    })),
    local: (data?.local ?? []).filter((f) => f.isFile).map((f) => apiFileToChannelFile(f, 'local')),
    truncated: !!data?.truncated,
    mode: 'server'
  };
}

/** Older servers: recursive v1 search, favourite channels only. */
async function favoritesSearch(q: string, signal?: AbortSignal): Promise<SearchResults> {
  const favorites = (await channelsApi.getFavorites()).slice(0, FALLBACK_MAX_CHANNELS);
  const v1 = await getV1Api();
  const groups: ChannelSearchGroup[] = [];
  const failed: string[] = [];
  let truncated = false;

  const searchOne = async (channel: { id: number; name: string }) => {
    try {
      const { items, page } = await v1.files.search(
        String(channel.id),
        { q, filter: 'audio', filesOnly: true, pageSize: FALLBACK_PER_CHANNEL },
        signal
      );
      const files = items
        .filter((f) => f.isFile && f.category === 'Audio')
        .map((f) => apiFileToChannelFile(f, 'channel'));
      if (page.totalItems > files.length) truncated = true;
      if (files.length > 0) {
        groups.push({ channelId: String(channel.id), channelName: channel.name, files });
      }
    } catch (error) {
      if (signal?.aborted) throw error;
      failed.push(channel.name);
      console.warn(`Search failed in channel ${channel.name}:`, error);
    }
  };

  // Small worker pool: a few channels at a time
  const queue = [...favorites];
  await Promise.all(
    Array.from({ length: Math.min(FALLBACK_CONCURRENCY, queue.length) }, async () => {
      while (queue.length > 0) {
        await searchOne(queue.shift()!);
      }
    })
  );

  // Every channel failing is an error, not "no results"
  if (favorites.length > 0 && failed.length === favorites.length) {
    throw new Error('Search failed in every favourite channel');
  }

  groups.sort((a, b) => a.channelName.localeCompare(b.channelName));
  return { channels: groups, local: [], truncated, mode: 'favorites', failedChannels: failed };
}
export const searchApi = {
  /**
   * Audio search across channels and local files. Uses the server-wide v1
   * search (`search.v1`), else the mobile one (`search.global`), otherwise
   * searches the favourite channels one by one.
   */
  async search(q: string, scope: SearchScope = 'all', signal?: AbortSignal): Promise<SearchResults> {
    const caps = await serverCapabilities.get();
    if (caps.features.has('search.v1')) {
      return v1Search(q, scope, signal);
    }
    if (caps.features.has('search.global')) {
      return serverSearch(q, scope, signal);
    }
    if (scope === 'local') {
      return { channels: [], local: [], truncated: false, mode: 'favorites' };
    }
    return favoritesSearch(q, signal);
  }
};
