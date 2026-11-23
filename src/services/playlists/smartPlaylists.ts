import { db, type SmartPlaylistEntity } from '@/db/database';
import { collectChannelFolderTracks, collectLocalFolderTracks } from '@/utils/collectTracks';
import { t } from '@/i18n';
import type { Track } from '@/types/models';

export type SmartSource =
  | { kind: 'channel'; channelId: string; channelName: string }
  | { kind: 'local' };

export type SmartSort = 'name' | 'newest' | 'oldest' | 'random';

/** Rules of a smart playlist. Every set rule must match (AND). */
export interface SmartRules {
  sources: SmartSource[];
  /** Extensions without dot, lowercase; empty = any audio. */
  formats: string[];
  /** Case-insensitive text the file name (or path) must contain. */
  nameContains: string;
  /** Only files added in the last N days (0 = any time). */
  addedWithinDays: number;
  sort: SmartSort;
  /** Maximum tracks (the folder walk stops at 2000 per source anyway). */
  limit: number;
}

export interface SmartPlaylist {
  id: string;
  name: string;
  rules: SmartRules;
  createdAt: Date;
  updatedAt: Date;
}

export const DEFAULT_SMART_RULES: SmartRules = {
  sources: [],
  formats: [],
  nameContains: '',
  addedWithinDays: 0,
  sort: 'name',
  limit: 500
};

function fromEntity(e: SmartPlaylistEntity): SmartPlaylist {
  let rules: SmartRules = DEFAULT_SMART_RULES;
  try {
    rules = { ...DEFAULT_SMART_RULES, ...JSON.parse(e.rulesJson) };
  } catch {
    // keep defaults
  }
  return { id: e.id, name: e.name, rules, createdAt: e.createdAt, updatedAt: e.updatedAt };
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/**
 * Apply the rules to an already collected track list. Pure, so it is
 * unit-tested on its own; `now` is injectable for the date rule.
 */
export function applySmartRules(tracks: Track[], rules: SmartRules, now = Date.now()): Track[] {
  const formats = new Set(rules.formats.map((f) => f.toLowerCase()));
  const needle = rules.nameContains.trim().toLowerCase();
  const since = rules.addedWithinDays > 0 ? now - rules.addedWithinDays * 86_400_000 : 0;

  const seen = new Set<string>();
  let result = tracks.filter((track) => {
    if (seen.has(track.fileId)) return false;
    seen.add(track.fileId);
    if (formats.size > 0 && !formats.has(extensionOf(track.fileName))) return false;
    if (needle && !`${track.filePath ?? ''}/${track.fileName}`.toLowerCase().includes(needle)) return false;
    if (since > 0) {
      const added = Date.parse(track.dateAdded);
      if (!Number.isFinite(added) || added < since) return false;
    }
    return true;
  });

  switch (rules.sort) {
    case 'name':
      result.sort((a, b) => a.fileName.localeCompare(b.fileName, undefined, { numeric: true, sensitivity: 'base' }));
      break;
    case 'newest':
    case 'oldest': {
      const dir = rules.sort === 'newest' ? -1 : 1;
      result.sort((a, b) => dir * ((Date.parse(a.dateAdded) || 0) - (Date.parse(b.dateAdded) || 0)));
      break;
    }
    case 'random':
      result = [...result];
      for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
      }
      break;
  }

  return rules.limit > 0 ? result.slice(0, rules.limit) : result;
}

export const smartPlaylists = {
  async list(): Promise<SmartPlaylist[]> {
    const rows = await db.smartPlaylists.orderBy('updatedAt').reverse().toArray();
    return rows.map(fromEntity);
  },

  async get(id: string): Promise<SmartPlaylist | undefined> {
    const row = await db.smartPlaylists.get(id);
    return row ? fromEntity(row) : undefined;
  },

  async save(playlist: { id?: string; name: string; rules: SmartRules }): Promise<SmartPlaylist> {
    const now = new Date();
    const existing = playlist.id ? await db.smartPlaylists.get(playlist.id) : undefined;
    const entity: SmartPlaylistEntity = {
      id: playlist.id ?? (crypto.randomUUID?.() ?? `smart-${now.getTime()}`),
      name: playlist.name.trim() || t('Smart playlist'),
      rulesJson: JSON.stringify(playlist.rules),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };
    await db.smartPlaylists.put(entity);
    return fromEntity(entity);
  },

  async remove(id: string): Promise<void> {
    await db.smartPlaylists.delete(id);
  },

  /** Walk the sources (whole channel / local tree) and apply the rules. */
  async evaluate(rules: SmartRules, onProgress?: (label: string) => void): Promise<Track[]> {
    const collected: Track[] = [];
    for (const source of rules.sources) {
      if (source.kind === 'channel') {
        onProgress?.(source.channelName);
        collected.push(...await collectChannelFolderTracks(source.channelId, source.channelName, ''));
      } else {
        onProgress?.(t('Local files'));
        collected.push(...await collectLocalFolderTracks(''));
      }
    }
    return applySmartRules(collected, rules);
  }
};
