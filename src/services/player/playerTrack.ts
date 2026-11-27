import { buildLocalStreamUrlSync, buildStreamUrlSync } from '@/services/api/client';
import type { ApiPlayerTrackDto } from '@/services/api/v1';
import { serverCapabilities } from '@/services/server/capabilities';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Track } from '@/types/models';

/** Same key the server computes: `channel:{channelId}:{fileId}` or `local:{path}`. */
export function trackKey(track: Pick<Track, 'isLocalFile' | 'filePath' | 'channelId' | 'fileId'>): string {
  if (track.isLocalFile) {
    // The server normalises local paths: forward slashes, no leading slash
    const path = (track.filePath ?? '').replace(/\\/g, '/').trim().replace(/^\/+/, '');
    return `local:${path}`;
  }
  return `channel:${String(track.channelId).trim()}:${String(track.fileId).trim()}`;
}

export function toApiTrack(track: Track): ApiPlayerTrackDto {
  return {
    key: trackKey(track),
    channelId: track.isLocalFile ? null : track.channelId,
    fileId: track.isLocalFile ? null : track.fileId,
    isLocalFile: track.isLocalFile,
    filePath: track.isLocalFile ? track.filePath : track.filePath || null,
    fileName: track.fileName,
    channelName: track.channelName || null,
    title: track.title ?? null,
    artist: track.artist ?? null,
    album: track.album ?? null,
    duration: track.duration ?? null,
    fileSize: track.fileSize || null
  };
}

/** A track the server remembers, ready for the queue. */
export function fromApiTrack(dto: ApiPlayerTrackDto): Track {
  const isLocal = !!dto.isLocalFile;
  const path = dto.filePath ?? '';
  const fileId = isLocal ? path : dto.fileId ?? '';
  // Local tracks are addressed by their path, like localFileToTrack does
  const channelId = isLocal ? 'local' : dto.channelId ?? '';
  const ext = dto.fileName.includes('.') ? dto.fileName.slice(dto.fileName.lastIndexOf('.')) : '';
  return {
    fileId,
    channelId,
    channelName: dto.channelName ?? (isLocal ? 'Local Files' : ''),
    fileName: dto.fileName,
    filePath: path,
    fileType: ext,
    fileSize: dto.fileSize ?? 0,
    order: 0,
    dateAdded: '',
    isLocalFile: isLocal,
    streamUrl: isLocal ? buildLocalStreamUrlSync(path) : buildStreamUrlSync(channelId, fileId, dto.fileName),
    duration: dto.duration ?? undefined,
    title: dto.title ?? dto.fileName.replace(/\.[^/.]+$/, ''),
    artist: dto.artist ?? undefined,
    album: dto.album ?? undefined
  };
}

/** Favourites, history and resume points go to the server (feature + setting). */
export async function playerSyncEnabled(): Promise<boolean> {
  if (!useSettingsStore.getState().syncPlayerData) return false;
  return serverCapabilities.has('player.sync');
}
