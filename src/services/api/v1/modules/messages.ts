// Telegram message history of a chat (`messages.browse`), read straight from
// Telegram: works for channels that were never indexed.
import type { HttpClient } from '../http';

export interface ApiChannelMessageDto {
  id: number;
  /** ISO date. */
  date: string;
  text?: string | null;
  hasMedia: boolean;
  mediaType?: 'photo' | 'video' | 'audio' | 'document' | null;
  fileName?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  from?: string | null;
  /** Seconds (audio and video). */
  duration?: number | null;
  /** Song tags, when Telegram has them. */
  title?: string | null;
  performer?: string | null;
}

export interface ApiMessageSearchDto {
  items: ApiChannelMessageDto[];
  total: number;
  /** Pass as `offsetId` for the next (older) page; null at the end. */
  nextOffsetId: number | null;
}

export type MessageKind = 'media' | 'photos' | 'videos' | 'documents' | 'audio' | 'voice' | 'gifs' | 'links';

const enc = encodeURIComponent;

export function createMessagesApi(http: HttpClient) {
  return {
    /** GET /api/v1/channels/{id}/messages/search (newest first). */
    search: (channelId: string, query: { q?: string; kind?: MessageKind; offsetId?: number; limit?: number }, signal?: AbortSignal) =>
      http.get<ApiMessageSearchDto>(`/api/v1/channels/${enc(channelId)}/messages/search`, { query: { ...query }, signal }),
    /** GET /api/v1/channels/{id}/messages/counts */
    counts: (channelId: string, signal?: AbortSignal) =>
      http.get<Partial<Record<MessageKind, number>>>(`/api/v1/channels/${enc(channelId)}/messages/counts`, { signal })
  };
}
