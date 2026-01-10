import Dexie, { type Table } from 'dexie';

// Database entity types
export interface ServerConfigEntity {
  id?: number;
  host: string;
  port: number;
  apiKey: string;
  useHttps: boolean;
  lastConnected?: Date;
}

export interface CachedTrackEntity {
  id: string;
  channelId?: string;
  channelName?: string;
  fileName: string;
  fileSize: number;
  duration?: number;
  title?: string;
  artist?: string;
  album?: string;
  streamUrl?: string;
  cachedAt: Date;
  lastPlayedAt?: Date;
  blob: Blob;
  coverArt?: string; // Base64 data URL for album art
}

export interface OfflinePlaylistEntity {
  id: string;
  name: string;
  description?: string;
  trackCount: number;
  tracksJson: string;
  savedAt: Date;
  autoSync: boolean;
  lastSyncedAt?: Date;
}

export interface DownloadQueueEntity {
  id?: number;
  trackId: string;
  streamUrl: string;
  fileName: string;
  channelId: string;
  channelName: string;
  fileSize: number;
  status: 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  errorMessage?: string;
  addedAt: Date;
  completedAt?: Date;
}

export interface PlayHistoryEntity {
  id?: number;
  trackId: string;
  channelId: string;
  fileName: string;
  playedAt: Date;
}

// Cached playlists list (for offline access to all playlists)
export interface CachedPlaylistEntity {
  id: string;
  name: string;
  description?: string;
  trackCount: number;
  dateCreated: string;
  dateModified: string;
  cachedAt: Date;
}

class TFMAudioDatabase extends Dexie {
  serverConfig!: Table<ServerConfigEntity>;
  cachedTracks!: Table<CachedTrackEntity>;
  offlinePlaylists!: Table<OfflinePlaylistEntity>;
  downloadQueue!: Table<DownloadQueueEntity>;
  playHistory!: Table<PlayHistoryEntity>;
  cachedPlaylists!: Table<CachedPlaylistEntity>;

  constructor() {
    super('TFMAudioDB');

    this.version(1).stores({
      serverConfig: '++id',
      cachedTracks: 'id, channelId, cachedAt, lastPlayedAt',
      offlinePlaylists: 'id, autoSync',
      downloadQueue: '++id, trackId, status, addedAt',
      playHistory: '++id, trackId, playedAt'
    });

    // Version 2: Add cached playlists table
    this.version(2).stores({
      serverConfig: '++id',
      cachedTracks: 'id, channelId, cachedAt, lastPlayedAt',
      offlinePlaylists: 'id, autoSync',
      downloadQueue: '++id, trackId, status, addedAt',
      playHistory: '++id, trackId, playedAt',
      cachedPlaylists: 'id, cachedAt'
    });

    // Version 3: Add coverArt field to cachedTracks (no index change needed)
    this.version(3).stores({
      serverConfig: '++id',
      cachedTracks: 'id, channelId, cachedAt, lastPlayedAt',
      offlinePlaylists: 'id, autoSync',
      downloadQueue: '++id, trackId, status, addedAt',
      playHistory: '++id, trackId, playedAt',
      cachedPlaylists: 'id, cachedAt'
    });
  }
}

export const db = new TFMAudioDatabase();

// Helper functions
export async function getServerConfig(): Promise<ServerConfigEntity | undefined> {
  const configs = await db.serverConfig.toArray();
  return configs[0];
}

export async function saveServerConfig(config: Omit<ServerConfigEntity, 'id'>): Promise<void> {
  await db.serverConfig.clear();
  await db.serverConfig.add({
    ...config,
    lastConnected: new Date()
  });
}

export async function isServerConfigured(): Promise<boolean> {
  const count = await db.serverConfig.count();
  return count > 0;
}

export async function clearServerConfig(): Promise<void> {
  await db.serverConfig.clear();
}

// Offline playlist helpers
export async function saveOfflinePlaylist(
  id: string,
  name: string,
  description: string | undefined,
  tracks: unknown[],
  autoSync: boolean = true
): Promise<void> {
  await db.offlinePlaylists.put({
    id,
    name,
    description,
    trackCount: tracks.length,
    tracksJson: JSON.stringify(tracks),
    savedAt: new Date(),
    autoSync,
    lastSyncedAt: new Date()
  });
}

export async function getOfflinePlaylist(id: string): Promise<OfflinePlaylistEntity | undefined> {
  return db.offlinePlaylists.get(id);
}

export async function getAllOfflinePlaylists(): Promise<OfflinePlaylistEntity[]> {
  return db.offlinePlaylists.toArray();
}

export async function deleteOfflinePlaylist(id: string): Promise<void> {
  await db.offlinePlaylists.delete(id);
}

export async function isPlaylistOffline(id: string): Promise<boolean> {
  const playlist = await db.offlinePlaylists.get(id);
  return !!playlist;
}

// Cached playlists helpers (for offline list view)
export async function saveCachedPlaylists(playlists: Array<{
  id: string;
  name: string;
  description?: string;
  trackCount: number;
  dateCreated: string;
  dateModified: string;
}>): Promise<void> {
  const cachedAt = new Date();
  await db.cachedPlaylists.clear();
  await db.cachedPlaylists.bulkPut(
    playlists.map(p => ({ ...p, cachedAt }))
  );
}

export async function getCachedPlaylists(): Promise<CachedPlaylistEntity[]> {
  return db.cachedPlaylists.toArray();
}

export async function updateCachedPlaylist(playlist: {
  id: string;
  name: string;
  description?: string;
  trackCount: number;
  dateCreated: string;
  dateModified: string;
}): Promise<void> {
  await db.cachedPlaylists.put({ ...playlist, cachedAt: new Date() });
}

export async function deleteCachedPlaylist(id: string): Promise<void> {
  await db.cachedPlaylists.delete(id);
}

// Cover art helpers
export async function updateTrackCoverArt(trackId: string, coverArt: string): Promise<void> {
  await db.cachedTracks.update(trackId, { coverArt });
}

export async function getTrackCoverArt(trackId: string): Promise<string | undefined> {
  const track = await db.cachedTracks.get(trackId);
  return track?.coverArt;
}
