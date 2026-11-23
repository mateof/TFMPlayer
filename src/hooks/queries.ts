import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { channelsApi } from '@/services/api/channels.api';
import { playlistsApi } from '@/services/api/playlists.api';
import { queryKeys } from '@/services/query/queryClient';
import type { Channel } from '@/types/models';

// Lists that should survive reloads and work offline are persisted
const persisted = { meta: { persist: true } } as const;

export function useChannelsQuery() {
  return useQuery({ queryKey: queryKeys.channels.all, queryFn: channelsApi.getAll, ...persisted });
}

export function useFavoriteChannelsQuery() {
  return useQuery({ queryKey: queryKeys.channels.favorites, queryFn: channelsApi.getFavorites, ...persisted });
}

export function useChannelFoldersQuery() {
  return useQuery({ queryKey: queryKeys.channels.folders, queryFn: channelsApi.getFolders, ...persisted });
}

export function useChannelInfoQuery(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.channels.info(id ?? ''),
    queryFn: () => channelsApi.getInfo(parseInt(id!)),
    enabled: !!id,
    ...persisted
  });
}

/** v1 statistics. Not retried: older servers answer 404 and that's final. */
export function useChannelStatsQuery(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.channels.stats(id ?? ''),
    queryFn: () => channelsApi.getStats(id!),
    enabled: !!id,
    retry: false,
    ...persisted
  });
}

export function usePlaylistsQuery() {
  return useQuery({ queryKey: queryKeys.playlists.all, queryFn: playlistsApi.getAll, ...persisted });
}

/** Star / unstar a channel; every channel list is refreshed afterwards. */
export function useToggleFavoriteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (channel: Channel) => {
      if (channel.isFavorite) {
        await channelsApi.removeFromFavorites(channel.id);
      } else {
        await channelsApi.addToFavorites(channel.id);
      }
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['channels'] })
  });
}
