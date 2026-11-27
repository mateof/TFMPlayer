// Shared player data of TelegramFileManager (`player.sync`): favourite tracks,
// play history and resume points, the same for the web app and every device.
import type { HttpClient } from '../http';

/** A track as the server stores it (a snapshot of what the client knew). */
export interface ApiPlayerTrackDto {
  /** `channel:{channelId}:{fileId}` or `local:{path}` (computed by the server). */
  key?: string;
  channelId: string | null;
  fileId: string | null;
  isLocalFile: boolean;
  filePath: string | null;
  fileName: string;
  channelName?: string | null;
  title?: string | null;
  artist?: string | null;
  album?: string | null;
  /** Seconds. */
  duration?: number | null;
  fileSize?: number | null;
}

export interface ApiFavoriteTrackDto extends ApiPlayerTrackDto {
  addedAt: string;
}

export interface ApiFavoritesPageDto {
  items: ApiFavoriteTrackDto[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiHistoryEntryDto {
  id: string;
  track: ApiPlayerTrackDto;
  playedAt: string;
  positionSeconds?: number | null;
  completed: boolean;
}

export interface ApiHistoryPageDto {
  items: ApiHistoryEntryDto[];
  hasMore: boolean;
}

export interface ApiTopTrackDto {
  track: ApiPlayerTrackDto;
  playCount: number;
  lastPlayedAt: string;
}

export interface ApiResumePointDto {
  track: ApiPlayerTrackDto;
  positionSeconds: number;
  durationSeconds: number;
  updatedAt: string;
  /** PUT only: the position was at the end, so the point was deleted. */
  finished?: boolean;
}

/** Payload of the events hub's `PlayerDataChanged` message. */
export interface PlayerDataChangedEvent {
  kind: 'favorites' | 'history' | 'resume';
  key: string | null;
}

const base = '/api/v1/player';

export function createPlayerApi(http: HttpClient) {
  return {
    favorites: (query: { page?: number; pageSize?: number } = {}, signal?: AbortSignal) =>
      http.get<ApiFavoritesPageDto>(`${base}/favorites`, { query: { ...query }, signal }),
    favoriteKeys: (signal?: AbortSignal) => http.get<string[]>(`${base}/favorites/keys`, { signal }),
    addFavorite: (track: ApiPlayerTrackDto) => http.put<ApiFavoriteTrackDto>(`${base}/favorites`, track),
    removeFavorite: (key: string) => http.delete<void>(`${base}/favorites`, undefined, { query: { key } }),

    addHistory: (body: { track: ApiPlayerTrackDto; playedAt?: string; positionSeconds?: number; completed?: boolean }) =>
      http.post<void>(`${base}/history`, body),
    history: (query: { limit?: number; before?: string } = {}, signal?: AbortSignal) =>
      http.get<ApiHistoryPageDto>(`${base}/history`, { query: { ...query }, signal }),
    topTracks: (query: { limit?: number; days?: number } = {}, signal?: AbortSignal) =>
      http.get<ApiTopTrackDto[]>(`${base}/history/top`, { query: { ...query }, signal }),
    clearHistory: () => http.delete<void>(`${base}/history`),

    saveResume: (body: { track: ApiPlayerTrackDto; positionSeconds: number; durationSeconds: number }) =>
      http.put<ApiResumePointDto>(`${base}/resume`, body),
    resume: (key: string, signal?: AbortSignal) => http.get<ApiResumePointDto>(`${base}/resume`, { query: { key }, signal }),
    resumeList: (limit = 50, signal?: AbortSignal) =>
      http.get<ApiResumePointDto[]>(`${base}/resume/list`, { query: { limit }, signal }),
    removeResume: (key: string) => http.delete<void>(`${base}/resume`, undefined, { query: { key } })
  };
}

export type PlayerApi = ReturnType<typeof createPlayerApi>;
