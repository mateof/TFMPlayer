import { QueryClient } from '@tanstack/react-query';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { db } from '@/db/database';

/**
 * One QueryClient for the app, persisted to IndexedDB so lists render
 * instantly (and offline) from the last visit, then refresh in background.
 * Only queries flagged with `meta: { persist: true }` are written to disk.
 */
export const PERSIST_MAX_AGE = 7 * 24 * 60 * 60 * 1000; // 7 days

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 60 * 1000,
      // Must outlive the persisted copy, or restored entries get dropped
      gcTime: PERSIST_MAX_AGE,
      refetchOnWindowFocus: false,
      // Cached data stays on screen when the request fails (offline)
      networkMode: 'offlineFirst'
    }
  }
});

const PERSIST_KEY = 'react-query-cache';

// Persist through the existing apiCache table: no schema change needed
export const queryPersister = createAsyncStoragePersister({
  key: PERSIST_KEY,
  throttleTime: 2000,
  storage: {
    getItem: async (key) => (await db.apiCache.get(key))?.json ?? null,
    setItem: async (key, value) => {
      await db.apiCache.put({ key, json: value, cachedAt: new Date() });
    },
    removeItem: async (key) => {
      await db.apiCache.delete(key);
    }
  }
});

// Bump to throw away persisted data whose shape no longer matches
export const QUERY_CACHE_BUSTER = 'v1';

/** Query keys in one place so invalidation can't drift from the queries. */
export const queryKeys = {
  channels: {
    all: ['channels', 'all'] as const,
    favorites: ['channels', 'favorites'] as const,
    folders: ['channels', 'folders'] as const,
    info: (id: string) => ['channels', id, 'info'] as const,
    stats: (id: string) => ['channels', id, 'stats'] as const
  },
  playlists: {
    all: ['playlists', 'all'] as const
  },
  search: (q: string, scope: string) => ['search', q, scope] as const
};
