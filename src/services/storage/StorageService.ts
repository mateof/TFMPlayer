import { db, getAllOfflinePlaylists } from '@/db/database';
import { useSettingsStore } from '@/stores/settingsStore';
import { log } from '@/utils/logger';
import { t } from '@/i18n';
import type { Track } from '@/types/models';

export interface StorageGroup {
  /** channel id, or 'local' */
  key: string;
  label: string;
  count: number;
  bytes: number;
  /** Tracks downloaded by the user (vs cached automatically while streaming) */
  manual: number;
  /** Tracks that belong to a playlist kept offline (never auto-cleaned) */
  protectedCount: number;
}

export interface StorageReport {
  usage: number | null;
  quota: number | null;
  persisted: boolean | null;
  trackCount: number;
  trackBytes: number;
  groups: StorageGroup[];
  offlinePlaylistCount: number;
  protectedCount: number;
}

const DAY_MS = 86_400_000;

/** Track ids of every playlist saved for offline: cleaning never touches them. */
async function protectedTrackIds(): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const playlist of await getAllOfflinePlaylists()) {
    try {
      for (const track of JSON.parse(playlist.tracksJson) as Track[]) ids.add(track.fileId);
    } catch {
      // ignore a corrupt entry
    }
  }
  return ids;
}

// Only the fields needed: avoids keeping Blob handles around longer than needed
async function readTrackRows() {
  const rows: { id: string; channelId?: string; channelName?: string; fileSize: number; autoCached?: boolean; lastUsed: number }[] = [];
  await db.cachedTracks.each((ct) => {
    rows.push({
      id: ct.id,
      channelId: ct.channelId,
      channelName: ct.channelName,
      fileSize: ct.fileSize || 0,
      autoCached: ct.autoCached,
      lastUsed: +(ct.lastPlayedAt ?? ct.cachedAt ?? 0)
    });
  });
  return rows;
}

export const storageService = {
  async report(): Promise<StorageReport> {
    const [rows, protectedIds, offline] = await Promise.all([readTrackRows(), protectedTrackIds(), getAllOfflinePlaylists()]);

    const groups = new Map<string, StorageGroup>();
    for (const row of rows) {
      const isLocal = !row.channelId || row.channelId === 'local';
      const key = isLocal ? 'local' : row.channelId!;
      const group = groups.get(key) ?? {
        key,
        label: isLocal ? t('Local files') : row.channelName || row.channelId!,
        count: 0,
        bytes: 0,
        manual: 0,
        protectedCount: 0
      };
      group.count++;
      group.bytes += row.fileSize;
      if (!row.autoCached) group.manual++;
      if (protectedIds.has(row.id)) group.protectedCount++;
      groups.set(key, group);
    }

    let usage: number | null = null;
    let quota: number | null = null;
    let persisted: boolean | null = null;
    try {
      const estimate = await navigator.storage?.estimate?.();
      usage = estimate?.usage ?? null;
      quota = estimate?.quota ?? null;
      persisted = (await navigator.storage?.persisted?.()) ?? null;
    } catch {
      // Storage API unavailable
    }

    return {
      usage,
      quota,
      persisted,
      trackCount: rows.length,
      trackBytes: rows.reduce((sum, r) => sum + r.fileSize, 0),
      groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes),
      offlinePlaylistCount: offline.length,
      protectedCount: rows.filter((r) => protectedIds.has(r.id)).length
    };
  },

  /** Delete every stored track of a channel (or 'local'), except offline-playlist ones. */
  async deleteGroup(key: string): Promise<number> {
    const protectedIds = await protectedTrackIds();
    const ids = (await readTrackRows())
      .filter((r) => ((!r.channelId || r.channelId === 'local') ? 'local' : r.channelId) === key)
      .filter((r) => !protectedIds.has(r.id))
      .map((r) => r.id);
    await db.cachedTracks.bulkDelete(ids);
    return ids.length;
  },

  /** Delete tracks not played (or downloaded) in `days` days, offline playlists excluded. */
  async cleanNotPlayedSince(days: number): Promise<{ count: number; bytes: number }> {
    if (days <= 0) return { count: 0, bytes: 0 };
    const cutoff = Date.now() - days * DAY_MS;
    const protectedIds = await protectedTrackIds();
    const victims = (await readTrackRows()).filter((r) => r.lastUsed < cutoff && !protectedIds.has(r.id));
    await db.cachedTracks.bulkDelete(victims.map((v) => v.id));
    return { count: victims.length, bytes: victims.reduce((sum, v) => sum + v.fileSize, 0) };
  },

  /** Runs once per start when automatic cleaning is enabled in Settings. */
  async autoClean(): Promise<void> {
    const days = useSettingsStore.getState().autoCleanDays;
    if (!days) return;
    try {
      const { count, bytes } = await this.cleanNotPlayedSince(days);
      if (count > 0) log.info(`Auto-clean removed ${count} tracks (${Math.round(bytes / 1048576)} MB)`);
    } catch (error) {
      log.warn('Auto-clean failed', error);
    }
  }
};
