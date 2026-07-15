import { usePlayerStore } from '@/stores/playerStore';
import { channelsApi } from '@/services/api/channels.api';
import { fileToTrack, filterFilesByExtension, getApiFilter } from '@/utils/channelTracks';

let loading = false;

export function isLoadingQueuePage(): boolean {
  return loading;
}

// Fetch the next page of the queue's source (channel view with its filters,
// sort and search) and append the new tracks to the queue. Returns how many
// tracks were added. No-op when there is no paginated source or no more pages.
export async function loadNextQueuePage(): Promise<number> {
  const store = usePlayerStore.getState();
  const source = store.queueSource;
  if (!source || !source.hasMore || loading) return 0;

  loading = true;
  try {
    const { files, hasMore } = await channelsApi.getFiles(
      parseInt(source.channelId),
      source.folderId,
      {
        page: source.nextPage,
        pageSize: source.pageSize,
        filter: getApiFilter(source.filterMode),
        search: source.search,
        sortBy: source.sortBy,
        sortDesc: source.sortDesc
      }
    );

    // The queue may have been replaced while fetching
    const state = usePlayerStore.getState();
    if (state.queueSource !== source) return 0;

    const audioFiles = filterFilesByExtension(files, source.filterMode)
      .filter(f => f.category === 'Audio');

    const existingIds = new Set(state.queue.map(t => t.fileId));
    const newTracks = audioFiles
      .map(f => fileToTrack(f, source.channelId, source.channelName))
      .filter(t => !existingIds.has(t.fileId));

    if (newTracks.length > 0) {
      state.addMultipleToQueue(newTracks);
    }

    state.setQueueSource({
      ...source,
      nextPage: source.nextPage + 1,
      hasMore: hasMore && files.length > 0
    });

    return newTracks.length;
  } finally {
    loading = false;
  }
}
