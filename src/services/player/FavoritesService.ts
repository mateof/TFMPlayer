import { create } from 'zustand';
import { getApiCache, setApiCache } from '@/db/database';
import { getV1Api } from '@/services/api/v1';
import type { Track } from '@/types/models';
import { log } from '@/utils/logger';
import { fromApiTrack, playerSyncEnabled, toApiTrack, trackKey } from './playerTrack';

const LOCAL_KEY = 'favorite-tracks';

interface FavoriteEntry {
  track: Track;
  addedAt: number;
}

interface FavoritesState {
  /** Keys of the favourite tracks (see trackKey). */
  keys: Set<string>;
  loaded: boolean;
}

export const useFavoritesStore = create<FavoritesState>(() => ({ keys: new Set(), loaded: false }));

/** Is this track a favourite? (reactive) */
export function useIsFavorite(track: Track | null | undefined): boolean {
  const key = track ? trackKey(track) : null;
  return useFavoritesStore((s) => (key ? s.keys.has(key) : false));
}

/**
 * Favourite tracks. With `player.sync` they live on the server (the web app
 * and every device see the same ones); otherwise on this device. The device
 * list is uploaded once when the server starts supporting them, so nothing
 * marked before is lost.
 */
class FavoritesService {
  private local: FavoriteEntry[] | null = null;
  private loading: Promise<void> | null = null;

  private async readLocal(): Promise<FavoriteEntry[]> {
    this.local ??= (await getApiCache<FavoriteEntry[]>(LOCAL_KEY).catch(() => undefined)) ?? [];
    return this.local;
  }

  private async writeLocal(entries: FavoriteEntry[]): Promise<void> {
    this.local = entries;
    await setApiCache(LOCAL_KEY, entries).catch(() => {});
  }

  /** Loads the keys (server or device). Called at startup and on PlayerDataChanged. */
  load(force = false): Promise<void> {
    if (this.loading && !force) return this.loading;
    this.loading = (async () => {
      try {
        if (await playerSyncEnabled()) {
          const api = (await getV1Api()).player;
          const local = await this.readLocal();
          if (local.length > 0) {
            // Bring the favourites marked on this device before the server had them
            for (const entry of local) await api.addFavorite(toApiTrack(entry.track)).catch(() => {});
            await this.writeLocal([]);
          }
          const keys = await api.favoriteKeys();
          useFavoritesStore.setState({ keys: new Set(keys ?? []), loaded: true });
          return;
        }
      } catch (error) {
        log.warn('Could not read the favourite tracks of the server:', error);
      }
      const local = await this.readLocal();
      useFavoritesStore.setState({ keys: new Set(local.map((e) => trackKey(e.track))), loaded: true });
    })();
    return this.loading;
  }

  async toggle(track: Track): Promise<boolean> {
    const key = trackKey(track);
    const keys = new Set(useFavoritesStore.getState().keys);
    const add = !keys.has(key);
    // Optimistic: the heart changes at once, and goes back if the call fails
    if (add) keys.add(key);
    else keys.delete(key);
    useFavoritesStore.setState({ keys });

    try {
      if (await playerSyncEnabled()) {
        const api = (await getV1Api()).player;
        if (add) await api.addFavorite(toApiTrack(track));
        else await api.removeFavorite(key);
      } else {
        const local = (await this.readLocal()).filter((e) => trackKey(e.track) !== key);
        if (add) local.unshift({ track, addedAt: Date.now() });
        await this.writeLocal(local);
      }
      return add;
    } catch (error) {
      const back = new Set(useFavoritesStore.getState().keys);
      if (add) back.delete(key);
      else back.add(key);
      useFavoritesStore.setState({ keys: back });
      throw error;
    }
  }

  /** Favourite tracks, newest first. */
  async list(): Promise<Track[]> {
    if (await playerSyncEnabled()) {
      const api = (await getV1Api()).player;
      const tracks: Track[] = [];
      for (let page = 1; page <= 20; page++) {
        const result = await api.favorites({ page, pageSize: 500 });
        tracks.push(...(result?.items ?? []).map(fromApiTrack));
        if (!result || tracks.length >= result.total || result.items.length === 0) break;
      }
      return tracks;
    }
    return (await this.readLocal()).map((e) => e.track);
  }

  /** Test helper. */
  __reset(): void {
    this.local = null;
    this.loading = null;
    useFavoritesStore.setState({ keys: new Set(), loaded: false });
  }
}

export const favoritesService = new FavoritesService();
