import { apiClient } from './client';
import { channelsApi } from './channels.api';
import { serverCapabilities } from '@/services/server/capabilities';
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

// v1 file DTO, only the fields the fallback needs
interface V1FileDto {
  id: string;
  name: string;
  path: string;
  parentId?: string | null;
  isFile: boolean;
  hasChildren: boolean;
  size: number;
  type: string;
  category: string;
  dateCreated: string;
  dateModified: string;
  messageId?: number | null;
}

/** Older servers: recursive v1 search, favourite channels only. */
async function favoritesSearch(q: string, signal?: AbortSignal): Promise<SearchResults> {
  const favorites = (await channelsApi.getFavorites()).slice(0, FALLBACK_MAX_CHANNELS);
  const client = await apiClient.getClient();
  const groups: ChannelSearchGroup[] = [];
  let truncated = false;

  const searchOne = async (channel: { id: number; name: string }) => {
    try {
      const { data } = await client.get<{ data: V1FileDto[]; page?: { totalItems?: number } }>(
        `/api/v1/channels/${channel.id}/files/search`,
        { params: { q, filter: 'audio', filesOnly: true, pageSize: FALLBACK_PER_CHANNEL }, signal }
      );
      const files = (data.data ?? [])
        .filter((f) => f.isFile && f.category === 'Audio')
        .map<ChannelFile>((f) => ({
          id: f.id,
          name: f.name,
          path: f.path,
          parentId: f.parentId ?? '',
          size: f.size,
          type: f.type,
          category: 'Audio',
          dateCreated: f.dateCreated,
          dateModified: f.dateModified,
          messageId: f.messageId ?? undefined,
          isFile: true,
          hasChildren: false
        }));
      if ((data.page?.totalItems ?? 0) > files.length) truncated = true;
      if (files.length > 0) {
        groups.push({ channelId: String(channel.id), channelName: channel.name, files });
      }
    } catch (error) {
      if (signal?.aborted) throw error;
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

  groups.sort((a, b) => a.channelName.localeCompare(b.channelName));
  return { channels: groups, local: [], truncated, mode: 'favorites' };
}

export const searchApi = {
  /**
   * Audio search across channels and local files. Uses the server-wide
   * search when the server advertises `search.global`, otherwise searches
   * the favourite channels one by one.
   */
  async search(q: string, scope: SearchScope = 'all', signal?: AbortSignal): Promise<SearchResults> {
    if (await serverCapabilities.has('search.global')) {
      return serverSearch(q, scope, signal);
    }
    if (scope === 'local') {
      return { channels: [], local: [], truncated: false, mode: 'favorites' };
    }
    return favoritesSearch(q, signal);
  }
};
