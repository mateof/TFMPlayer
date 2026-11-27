import { apiClient } from '@/services/api/client';
import type { ApiChannelMessageDto } from '@/services/api/v1';
import type { Track } from '@/types/models';

/**
 * Audio attachments of Telegram messages that are not in the channel index
 * (`messages.content`). They play through
 * `GET /api/v1/channels/{id}/messages/{messageId}/content`, and their track id
 * says so: `msg:{channelId}:{messageId}`.
 */
const PREFIX = 'msg:';

export function messageTrackId(channelId: string, messageId: number): string {
  return `${PREFIX}${channelId}:${messageId}`;
}

export function isMessageTrack(track: Pick<Track, 'fileId'>): boolean {
  return track.fileId.startsWith(PREFIX);
}

/** Channel and message of a `msg:` track id. */
export function parseMessageTrackId(fileId: string): { channelId: string; messageId: number } | null {
  if (!fileId.startsWith(PREFIX)) return null;
  const rest = fileId.slice(PREFIX.length);
  const at = rest.lastIndexOf(':');
  const messageId = Number(rest.slice(at + 1));
  if (at <= 0 || !Number.isInteger(messageId)) return null;
  return { channelId: rest.slice(0, at), messageId };
}

/** The attachment's inline URL, without the key (add it for media elements). */
export function messageContentUrl(channelId: string, messageId: number): string {
  return `${apiClient.getBaseUrl()}/api/v1/channels/${encodeURIComponent(channelId)}/messages/${messageId}/content`;
}

export function messageToTrack(message: ApiChannelMessageDto, channelId: string, channelName: string): Track {
  const fileName = message.fileName || `${message.title || 'audio'}-${message.id}.mp3`;
  const ext = fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.')) : '';
  return {
    fileId: messageTrackId(channelId, message.id),
    messageId: message.id,
    channelId,
    channelName,
    fileName,
    filePath: '',
    fileType: ext,
    fileSize: message.fileSize ?? 0,
    order: 0,
    dateAdded: message.date,
    isLocalFile: false,
    streamUrl: messageContentUrl(channelId, message.id),
    duration: message.duration ?? undefined,
    title: message.title || fileName.replace(/\.[^/.]+$/, ''),
    artist: message.performer ?? undefined
  };
}
