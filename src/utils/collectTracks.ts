import { channelsApi } from '@/services/api/channels.api';
import { localFilesApi } from '@/services/api/localFiles.api';
import { buildLocalStreamUrlSync } from '@/services/api/client';
import { fileToTrack } from '@/utils/channelTracks';
import type { ChannelFile, Track } from '@/types/models';

const PAGE_SIZE = 100;

// Safety net so selecting a huge folder tree can't run away
const MAX_TRACKS = 2000;

// Local-file equivalent of fileToTrack. Synchronous: the API client is always
// initialized by the time a list is on screen, so bulk conversions don't need
// one await per file.
export function localFileToTrack(file: ChannelFile): Track {
  return {
    fileId: file.id,
    messageId: 0,
    channelId: 'local',
    channelName: 'Local Files',
    fileName: file.name,
    filePath: file.path,
    fileType: file.type,
    fileSize: file.size,
    order: 0,
    dateAdded: file.dateCreated,
    isLocalFile: true,
    streamUrl: buildLocalStreamUrlSync(file.path),
    title: file.name.replace(/\.[^/.]+$/, '')
  };
}

// Walk a channel folder (including its subfolders) collecting every audio file
export async function collectChannelFolderTracks(
  channelId: string,
  channelName: string,
  folderId: string,
  onProgress?: (found: number) => void
): Promise<Track[]> {
  const tracks: Track[] = [];
  const pending: string[] = [folderId];

  while (pending.length > 0 && tracks.length < MAX_TRACKS) {
    const current = pending.shift()!;
    let page = 1;

    while (tracks.length < MAX_TRACKS) {
      const { files, hasMore } = await channelsApi.getFiles(parseInt(channelId), current, {
        page,
        pageSize: PAGE_SIZE,
        filter: 'audio_folders',
        sortBy: 'name',
        sortDesc: false
      });

      for (const file of files) {
        if (file.category === 'Folder') {
          pending.push(file.id);
        } else if (file.category === 'Audio' && tracks.length < MAX_TRACKS) {
          tracks.push(fileToTrack(file, channelId, channelName));
        }
      }
      onProgress?.(tracks.length);

      if (!hasMore || files.length === 0) break;
      page++;
    }
  }

  return tracks;
}

// Same walk for the server's local file browser, keyed by path
export async function collectLocalFolderTracks(
  folderPath: string,
  onProgress?: (found: number) => void
): Promise<Track[]> {
  const tracks: Track[] = [];
  const pending: string[] = [folderPath];

  while (pending.length > 0 && tracks.length < MAX_TRACKS) {
    const current = pending.shift()!;
    let page = 1;

    while (tracks.length < MAX_TRACKS) {
      const { files, hasMore } = await localFilesApi.getFiles(current, {
        page,
        pageSize: PAGE_SIZE,
        filter: 'audio_folders',
        sortBy: 'name',
        sortDesc: false
      });

      for (const file of files) {
        if (file.category === 'Folder') {
          pending.push(file.path);
        } else if (file.category === 'Audio' && tracks.length < MAX_TRACKS) {
          tracks.push(localFileToTrack(file));
        }
      }
      onProgress?.(tracks.length);

      if (!hasMore || files.length === 0) break;
      page++;
    }
  }

  return tracks;
}

// Drop repeats (the same track can be reached from several selected items)
export function dedupeTracks(tracks: Track[]): Track[] {
  const seen = new Set<string>();
  const result: Track[] = [];
  for (const track of tracks) {
    if (seen.has(track.fileId)) continue;
    seen.add(track.fileId);
    result.push(track);
  }
  return result;
}

export const MAX_SELECTION_TRACKS = MAX_TRACKS;
