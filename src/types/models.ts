// Server configuration
export interface ServerConfig {
  id?: number;
  host: string;
  port: number;
  apiKey: string;
  useHttps: boolean;
  lastConnected?: Date;
}

// Channel models
export interface Channel {
  id: number;
  name: string;
  imageUrl: string;
  isOwner: boolean;
  canPost: boolean;
  isFavorite: boolean;
  type: 'channel' | 'group' | 'chat';
  fileCount: number;
}

export interface ChannelDetail extends Channel {
  totalSize: number;
  lastRefreshed?: Date;
  audioCount: number;
  videoCount: number;
  documentCount: number;
}

export interface ChannelFolder {
  id: number;
  title: string;
  iconEmoji: string;
  channelCount: number;
  channels: Channel[];
}

// File models
export interface ChannelFile {
  id: string;
  name: string;
  path: string;
  parentId: string;
  size: number;
  type: string;
  category: 'Audio' | 'Video' | 'Document' | 'Photo' | 'Folder';
  dateCreated: string;
  dateModified: string;
  messageId?: number;
  isFile: boolean;
  hasChildren: boolean;
  streamUrl?: string;
  downloadUrl?: string;
  thumbnailUrl?: string;
}

// Track model
export interface Track {
  fileId: string;
  messageId?: number;
  channelId: string;
  channelName: string;
  fileName: string;
  filePath: string;
  fileType: string;
  fileSize: number;
  order: number;
  dateAdded: string;
  isLocalFile: boolean;
  directUrl?: string;
  streamUrl: string;
  duration?: number;
  title?: string;
  artist?: string;
  album?: string;
}

// Playlist models
export interface Playlist {
  id: string;
  name: string;
  description?: string;
  trackCount: number;
  dateCreated: string;
  dateModified: string;
}

export interface PlaylistDetail extends Playlist {
  tracks: Track[];
}

// Audio info
export interface AudioInfo {
  fileName: string;
  fileSize: number;
  mimeType: string;
  duration?: number;
  bitrate?: number;
  title?: string;
  artist?: string;
  album?: string;
  supportsStreaming: boolean;
}

// Player types
export type RepeatMode = 'none' | 'all' | 'one';

export type PlaybackState =
  | 'stopped'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'buffering'
  | 'error';

// Download types
export type DownloadStatus = 'pending' | 'downloading' | 'completed' | 'failed' | 'cancelled';

export interface DownloadItem {
  id?: number;
  trackId: string;
  fileName: string;
  channelId: string;
  channelName: string;
  streamUrl: string;
  fileSize: number;
  status: DownloadStatus;
  progress: number;
  errorMessage?: string;
  addedAt: Date;
  completedAt?: Date;
}

// Cached track
export interface CachedTrack {
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
  autoCached?: boolean;
}

// Offline playlist
export interface OfflinePlaylist {
  id: string;
  name: string;
  description?: string;
  trackCount: number;
  tracksJson: string;
  savedAt: Date;
  autoSync: boolean;
  lastSyncedAt?: Date;
}

// API response wrapper
export interface ApiResult<T> {
  success: boolean;
  data: T;
  message?: string;
  totalCount?: number;
  page?: number;
  pageSize?: number;
}

// Request types
export interface CreatePlaylistRequest {
  name: string;
  description?: string;
}

export interface UpdatePlaylistRequest {
  name: string;
  description?: string;
}

export interface AddTrackRequest {
  fileId: string;
  channelId: string;
  fileName: string;
  fileSize: number;
  streamUrl: string;
  isLocalFile?: boolean;
  filePath?: string;
}
