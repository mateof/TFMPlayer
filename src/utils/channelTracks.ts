import { buildStreamUrlSync } from '@/services/api/client';
import type { ChannelFile, Track } from '@/types/models';

// Audio extensions available as client-side filters on the channel page
export const AUDIO_EXTENSIONS = ['mp3', 'flac', 'wav', 'ogg', 'opus', 'aac', 'm4a', 'wma', 'ape'];

export function isExtensionFilter(filterMode: string): boolean {
  return AUDIO_EXTENSIONS.includes(filterMode);
}

// The API only understands 'audio_folders' / 'audio'; extension filters are client-side
export function getApiFilter(filterMode: string): string {
  if (filterMode === 'audio_folders') return 'audio_folders';
  if (filterMode === 'audio' || isExtensionFilter(filterMode)) return 'audio';
  return 'audio_folders';
}

export function filterFilesByExtension(files: ChannelFile[], filterMode: string): ChannelFile[] {
  if (!isExtensionFilter(filterMode)) return files;

  const ext = `.${filterMode.toLowerCase()}`;
  return files.filter(f =>
    f.category === 'Folder' ||
    f.name.toLowerCase().endsWith(ext)
  );
}

// Convert ChannelFile to Track
export function fileToTrack(file: ChannelFile, channelId: string, channelName: string): Track {
  return {
    fileId: file.id,
    messageId: file.messageId,
    channelId: channelId,
    channelName: channelName,
    fileName: file.name,
    filePath: file.path,
    fileType: file.type,
    fileSize: file.size,
    order: 0,
    dateAdded: file.dateCreated,
    isLocalFile: false,
    streamUrl: file.streamUrl || buildStreamUrlSync(channelId, file.id, file.name),
    title: file.name.replace(/\.[^/.]+$/, '')
  };
}
