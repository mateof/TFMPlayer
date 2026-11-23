import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useLocation } from 'react-router-dom';
import { Music, Folder, Play, Plus, ChevronRight, Download, Search, SlidersHorizontal, X, Loader2, Check, CheckCircle2, Circle, RefreshCw, ListPlus, ListChecks } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { LoadingScreen } from '@/components/common/Spinner';
import { PlaylistPicker } from '@/components/playlists/PlaylistPicker';
import { SelectionBar } from '@/components/common/SelectionBar';
import { RefreshChannelDialog } from '@/components/channels/RefreshChannelDialog';
import { ChannelInfoPanel } from '@/components/channels/ChannelInfoPanel';
import { channelRefreshService, useChannelRefreshStore } from '@/services/channelRefresh/ChannelRefreshService';
import { channelsApi } from '@/services/api/channels.api';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useDebounce } from '@/hooks/useDebounce';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { useUiStore } from '@/stores/uiStore';
import { usePlayerStore } from '@/stores/playerStore';
import { formatFileSize, formatDate } from '@/utils/format';
import { fileToTrack, filterFilesByExtension, getApiFilter } from '@/utils/channelTracks';
import { collectChannelFolderTracks, dedupeTracks, MAX_SELECTION_TRACKS } from '@/utils/collectTracks';
import { downloadManager, useDownloadStore } from '@/services/download/DownloadManager';
import { cacheService } from '@/services/cache/CacheService';
import type { ChannelDetail, ChannelFile, ChannelStats, Track } from '@/types/models';

const PAGE_SIZE = 50;

type FilterMode = 'audio_folders' | 'audio' | 'mp3' | 'flac' | 'wav' | 'ogg' | 'aac' | 'm4a' | 'wma' | 'ape' | 'opus';
type SortBy = 'name' | 'date' | 'size' | 'type';

const categoryIcons: Record<string, React.ReactNode> = {
  Audio: <Music className="w-5 h-5" />,
  Folder: <Folder className="w-5 h-5" />
};

interface FolderBreadcrumb {
  id: string;
  name: string;
}

// Folders and files come from different id spaces, so key selections by both
const fileKey = (file: ChannelFile) => `${file.category}:${file.id}`;

export function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { addToast, getScrollPosition } = useUiStore();
  const { play, playNext } = useAudioPlayer();
  const activeDownloads = useDownloadStore((state) => state.activeDownloads);
  const completedDownloads = useDownloadStore((state) => state.completedDownloads);
  const clearCompleted = useDownloadStore((state) => state.clearCompleted);

  // State
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [channel, setChannel] = useState<ChannelDetail | null>(null);
  const [files, setFiles] = useState<ChannelFile[]>([]);
  const [folderPath, setFolderPath] = useState<FolderBreadcrumb[]>([]);
  const [pickerTracks, setPickerTracks] = useState<Track[] | null>(null);
  const [cachedTrackIds, setCachedTrackIds] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<ChannelStats | null>(null);
  const [showRefreshDialog, setShowRefreshDialog] = useState(false);
  const refreshJob = useChannelRefreshStore((s) => (id ? s.jobs[id] : undefined));

  // Multi-selection (long press to start)
  const selection = useMultiSelect<ChannelFile>(fileKey);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkLabel, setBulkLabel] = useState('');

  // Long press state
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // Filters - Initialize from URL params
  const urlFilterMode = searchParams.get('filter') as FilterMode | null;
  const urlSortBy = searchParams.get('sortBy') as SortBy | null;
  const urlSortDesc = searchParams.get('sortDesc');
  const urlSearch = searchParams.get('search');

  const [filterMode, setFilterModeState] = useState<FilterMode>(urlFilterMode || 'audio_folders');
  const [sortBy, setSortByState] = useState<SortBy>(urlSortBy || 'name');
  const [sortDesc, setSortDescState] = useState(urlSortDesc === 'true');
  const [searchText, setSearchTextState] = useState(urlSearch || '');
  const [showSearch, setShowSearch] = useState(!!urlSearch);
  const [showFilters, setShowFilters] = useState(false);

  // Sync filters to URL
  const updateUrlFilters = useCallback((updates: {
    filter?: FilterMode;
    sortBy?: SortBy;
    sortDesc?: boolean;
    search?: string;
  }) => {
    const params = new URLSearchParams(searchParams);

    if (updates.filter !== undefined) {
      if (updates.filter === 'audio_folders') {
        params.delete('filter');
      } else {
        params.set('filter', updates.filter);
      }
    }
    if (updates.sortBy !== undefined) {
      if (updates.sortBy === 'name') {
        params.delete('sortBy');
      } else {
        params.set('sortBy', updates.sortBy);
      }
    }
    if (updates.sortDesc !== undefined) {
      if (updates.sortDesc === false) {
        params.delete('sortDesc');
      } else {
        params.set('sortDesc', 'true');
      }
    }
    if (updates.search !== undefined) {
      if (updates.search === '') {
        params.delete('search');
      } else {
        params.set('search', updates.search);
      }
    }

    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  const setFilterMode = useCallback((mode: FilterMode) => {
    setFilterModeState(mode);
    updateUrlFilters({ filter: mode });
  }, [updateUrlFilters]);

  const setSortBy = useCallback((sort: SortBy) => {
    setSortByState(sort);
    updateUrlFilters({ sortBy: sort });
  }, [updateUrlFilters]);

  const setSortDesc = useCallback((desc: boolean) => {
    setSortDescState(desc);
    updateUrlFilters({ sortDesc: desc });
  }, [updateUrlFilters]);

  const setSearchText = useCallback((text: string) => {
    setSearchTextState(text);
    updateUrlFilters({ search: text });
  }, [updateUrlFilters]);

  // Debounce search text (0.7 seconds)
  const debouncedSearchText = useDebounce(searchText, 700);

  // Refs for infinite scroll
  const listRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Get current folder ID from URL params
  const currentFolderId = searchParams.get('folder') || undefined;
  const folderPathParam = searchParams.get('path');

  // Immediately update cache status when downloads complete
  useEffect(() => {
    if (!files.length) return;

    const audioFiles = files.filter(f => f.category === 'Audio');
    // Check if any completed download belongs to this view
    const completedInView = audioFiles.filter(f => completedDownloads.has(f.id));
    if (completedInView.length > 0) {
      // Immediately add to cached set
      setCachedTrackIds(prev => {
        const newSet = new Set(prev);
        completedInView.forEach(f => newSet.add(f.id));
        return newSet;
      });
      // Clear the completed flags
      completedInView.forEach(f => clearCompleted(f.id));
    }
  }, [completedDownloads, files, clearCompleted]);

  // Refresh cache status periodically when downloads are active
  useEffect(() => {
    if (!files.length) return;

    const audioFiles = files.filter(f => f.category === 'Audio');
    if (audioFiles.length === 0) return;

    const interval = setInterval(async () => {
      // Only refresh if there are active downloads for files in this view
      const hasActiveDownloads = audioFiles.some(f => activeDownloads.has(f.id));
      if (hasActiveDownloads) {
        const newCachedIds = new Set(cachedTrackIds);
        for (const file of audioFiles) {
          const isCached = await cacheService.isTrackCached(file.id);
          if (isCached) newCachedIds.add(file.id);
        }
        setCachedTrackIds(newCachedIds);
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [files, activeDownloads.size]);

  // Initialize folder path from URL
  useEffect(() => {
    if (folderPathParam) {
      try {
        const parsed = JSON.parse(decodeURIComponent(folderPathParam));
        setFolderPath(parsed);
      } catch {
        setFolderPath([]);
      }
    } else {
      setFolderPath([]);
    }
  }, [folderPathParam]);

  // Reset pagination when folder, filter, search, or sort changes
  useEffect(() => {
    setCurrentPage(1);
    setFiles([]);
    setHasMore(true);
  }, [currentFolderId, filterMode, debouncedSearchText, sortBy, sortDesc]);

  // Load channel info
  useEffect(() => {
    if (id) {
      loadChannel();
    }
  }, [id]);

  // Load files when parameters change
  useEffect(() => {
    if (id) {
      loadFiles(1, true);
    }
  }, [id, currentFolderId, filterMode, debouncedSearchText, sortBy, sortDesc]);

  // Restore scroll position when returning from player
  useEffect(() => {
    if (!loading && files.length > 0) {
      const savedPosition = getScrollPosition(location.pathname);
      if (savedPosition > 0) {
        // Use setTimeout to ensure DOM is ready
        setTimeout(() => {
          window.scrollTo(0, savedPosition);
        }, 100);
      }
    }
  }, [loading, files.length, location.pathname, getScrollPosition]);

  const loadChannel = async () => {
    try {
      const data = await channelsApi.getInfo(parseInt(id!));
      setChannel(data);
      loadStats(data.name);
    } catch (error) {
      addToast('Failed to load channel', 'error');
      console.error(error);
    }
  };

  // Richer statistics from the v1 API. Optional: older servers lack it.
  const loadStats = async (channelName?: string) => {
    try {
      const data = await channelsApi.getStats(id!);
      setStats(data);
      // A scan started elsewhere (web UI, another device): follow it too
      if (data.isRefreshing) {
        channelRefreshService.track(id!, channelName || data.name);
      }
    } catch (error) {
      console.warn('Channel statistics unavailable:', error);
      setStats(null);
    }
  };

  // When a refresh of this channel finishes, reload what it may have added
  const refreshPhase = refreshJob?.phase;
  const prevRefreshPhaseRef = useRef(refreshPhase);
  useEffect(() => {
    const prev = prevRefreshPhaseRef.current;
    prevRefreshPhaseRef.current = refreshPhase;
    if (prev === 'running' && refreshPhase && refreshPhase !== 'running') {
      loadStats(channel?.name);
      loadFiles(1, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshPhase]);

  // Files are sorted by the server - no client-side sorting needed
  // When sortBy/sortDesc changes, we reload from page 1 with new sort params

  const loadFiles = async (page: number, reset: boolean = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const { files: data, totalCount: total, hasMore: serverHasMore } = await channelsApi.getFiles(
        parseInt(id!),
        currentFolderId,
        {
          page,
          pageSize: PAGE_SIZE,
          filter: getApiFilter(filterMode),
          search: searchText || undefined,
          sortBy,
          sortDesc
        }
      );

      // Apply client-side extension filtering (sorting is done via useMemo)
      const filteredData = filterFilesByExtension(data, filterMode);

      if (reset) {
        setFiles(filteredData);
        setTotalCount(total);
        setHasMore(serverHasMore);
        setCurrentPage(page);
      } else {
        // For pagination, use functional update to avoid stale closure issues
        setFiles(currentFiles => {
          const existingIds = new Set(currentFiles.map(f => f.id));
          const newUniqueFiles = filteredData.filter(f => !existingIds.has(f.id));

          // If no new unique files, stop loading more (we've reached the end or server is returning duplicates)
          if (newUniqueFiles.length === 0) {
            console.log('No new unique files, stopping pagination');
            setHasMore(false);
            return currentFiles;
          } else {
            // Use server's hasMore flag, but also check for duplicates
            setHasMore(serverHasMore && newUniqueFiles.length > 0);
            setCurrentPage(page);
            return [...currentFiles, ...newUniqueFiles];
          }
        });
      }

      // Check cache status for audio files
      const audioFiles = filteredData.filter(f => f.category === 'Audio');
      const newCachedIds = new Set(cachedTrackIds);
      for (const file of audioFiles) {
        const isCached = await cacheService.isTrackCached(file.id);
        if (isCached) newCachedIds.add(file.id);
      }
      setCachedTrackIds(newCachedIds);
    } catch (error) {
      addToast('Failed to load files', 'error');
      console.error(error);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      loadingRef.current = false;
    }
  };

  // Infinite scroll handler
  const handleScroll = useCallback(() => {
    if (!listRef.current || loadingMore || !hasMore) return;

    const { scrollTop, scrollHeight, clientHeight } = listRef.current;
    const threshold = 200; // px from bottom

    if (scrollHeight - scrollTop - clientHeight < threshold) {
      loadFiles(currentPage + 1, false);
    }
  }, [currentPage, loadingMore, hasMore]);

  useEffect(() => {
    const list = listRef.current;
    if (list) {
      list.addEventListener('scroll', handleScroll);
      return () => list.removeEventListener('scroll', handleScroll);
    }
  }, [handleScroll]);

  const handleFileClick = (file: ChannelFile, e?: React.MouseEvent) => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    // Desktop: Ctrl/Cmd+click selects like a file manager
    if (e && (e.ctrlKey || e.metaKey)) {
      if (selection.selectionMode) {
        selection.toggle(file);
      } else {
        selection.startWith(file);
      }
      return;
    }
    // While selecting, a tap toggles instead of playing/navigating
    if (selection.selectionMode) {
      selection.toggle(file);
      return;
    }
    if (file.category === 'Folder') {
      const newPath = [...folderPath, { id: file.id, name: file.name }];
      const params = new URLSearchParams(searchParams);
      params.set('folder', file.id);
      params.set('path', encodeURIComponent(JSON.stringify(newPath)));
      setSearchParams(params);
    } else if (file.category === 'Audio') {
      playAudioFile(file);
    }
  };

  // Long press enters multi-selection mode (works for audio and folders)
  const handleLongPressStart = (file: ChannelFile, e: React.TouchEvent | React.MouseEvent) => {
    if (selection.selectionMode) return;
    longPressTriggeredRef.current = false;

    if ('touches' in e) {
      touchStartPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }

    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      selection.startWith(file);
    }, 500);
  };

  const handleLongPressMove = (e: React.TouchEvent) => {
    if (touchStartPosRef.current && longPressTimerRef.current) {
      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - touchStartPosRef.current.x);
      const deltaY = Math.abs(touch.clientY - touchStartPosRef.current.y);
      if (deltaX > 10 || deltaY > 10) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        touchStartPosRef.current = null;
      }
    }
  };

  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartPosRef.current = null;
  };

  // Expand the current selection into tracks, walking any selected folder
  const buildSelectedTracks = async (): Promise<Track[]> => {
    const selectedFiles = files.filter((f) => selection.selectedKeys.has(fileKey(f)));
    const collected: Track[] = [];

    for (const file of selectedFiles) {
      if (file.category === 'Audio') {
        collected.push(fileToTrack(file, id!, channel?.name || ''));
      } else if (file.category === 'Folder') {
        setBulkLabel(`Scanning "${file.name}"...`);
        const folderTracks = await collectChannelFolderTracks(
          id!,
          channel?.name || '',
          file.id,
          (found) => setBulkLabel(`Scanning "${file.name}" - ${found} tracks found`)
        );
        collected.push(...folderTracks);
      }
    }

    return dedupeTracks(collected);
  };

  // Run a bulk action over the selection, showing progress while folders expand
  const withSelectedTracks = async (action: (tracks: Track[]) => void | Promise<void>) => {
    setBulkBusy(true);
    setBulkLabel('Preparing...');
    try {
      const tracks = await buildSelectedTracks();
      if (tracks.length === 0) {
        addToast('No audio in the selection', 'info');
        return;
      }
      if (tracks.length >= MAX_SELECTION_TRACKS) {
        addToast(`Selection capped at the first ${MAX_SELECTION_TRACKS} tracks`, 'warning');
      }
      await action(tracks);
    } catch (error) {
      console.error('Bulk action failed:', error);
      addToast('Could not complete the action', 'error');
    } finally {
      setBulkBusy(false);
      setBulkLabel('');
    }
  };

  const handleBulkAddToPlaylist = () =>
    withSelectedTracks((tracks) => setPickerTracks(tracks));

  const handleBulkDownload = () =>
    withSelectedTracks(async (tracks) => {
      await downloadManager.addMultipleToQueue(tracks);
      addToast(`${tracks.length} track(s) queued for download`, 'success');
      selection.exitSelection();
    });

  const handleBulkPlayNext = () =>
    withSelectedTracks((tracks) => {
      // Insert backwards so the selection keeps its order in the queue
      for (let i = tracks.length - 1; i >= 0; i--) {
        playNext(tracks[i]);
      }
      addToast(`${tracks.length} track(s) will play next`, 'success');
      selection.exitSelection();
    });

  const navigateToFolder = (index: number) => {
    const params = new URLSearchParams(searchParams);

    if (index === -1) {
      params.delete('folder');
      params.delete('path');
    } else {
      const newPath = folderPath.slice(0, index + 1);
      params.set('folder', newPath[newPath.length - 1].id);
      params.set('path', encodeURIComponent(JSON.stringify(newPath)));
    }

    setSearchParams(params);
  };

  // Register where the queue came from so the player can page in more tracks
  // (queue infinite scroll + auto-load when nearing the end)
  const registerQueueSource = () => {
    usePlayerStore.getState().setQueueSource({
      type: 'channel',
      channelId: id!,
      channelName: channel?.name || '',
      folderId: currentFolderId,
      filterMode,
      search: searchText || undefined,
      sortBy,
      sortDesc,
      nextPage: currentPage + 1,
      pageSize: PAGE_SIZE,
      hasMore
    });
  };

  const playAudioFile = (file: ChannelFile) => {
    if (!channel) return;

    const audioFiles = files.filter(f => f.category === 'Audio');
    const tracks = audioFiles.map(f => fileToTrack(f, id!, channel.name));
    const startIndex = audioFiles.findIndex(f => f.id === file.id);

    const track = fileToTrack(file, id!, channel.name);
    play(track, tracks, startIndex >= 0 ? startIndex : 0);
    registerQueueSource();
  };

  const playAllAudio = () => {
    if (!channel) return;
    const audioFiles = files.filter(f => f.category === 'Audio');
    if (audioFiles.length === 0) {
      addToast('No audio files to play', 'info');
      return;
    }
    const tracks = audioFiles.map(f => fileToTrack(f, id!, channel.name));
    play(tracks[0], tracks, 0);
    registerQueueSource();
  };

  const handleAddToPlaylist = (file: ChannelFile, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!channel) return;
    const track = fileToTrack(file, id!, channel.name);
    setPickerTracks([track]);
  };

  const handlePlayNextFile = (file: ChannelFile, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!channel) return;
    playNext(fileToTrack(file, id!, channel.name));
    addToast('Will play next', 'success');
  };

  const handleDownload = async (file: ChannelFile, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!channel) return;

    const track = fileToTrack(file, id!, channel.name);
    await downloadManager.addToQueue(track);
    addToast('Added to download queue', 'info');
  };

  const filterOptions: { key: FilterMode; label: string; group?: string }[] = [
    { key: 'audio_folders', label: 'Audio + Folders', group: 'general' },
    { key: 'audio', label: 'All Audio', group: 'general' },
    { key: 'mp3', label: 'MP3', group: 'format' },
    { key: 'flac', label: 'FLAC', group: 'format' },
    { key: 'wav', label: 'WAV', group: 'format' },
    { key: 'ogg', label: 'OGG', group: 'format' },
    { key: 'opus', label: 'OPUS', group: 'format' },
    { key: 'aac', label: 'AAC', group: 'format' },
    { key: 'm4a', label: 'M4A', group: 'format' },
    { key: 'wma', label: 'WMA', group: 'format' },
    { key: 'ape', label: 'APE', group: 'format' }
  ];

  const sortOptions: { key: SortBy; label: string }[] = [
    { key: 'name', label: 'Name' },
    { key: 'date', label: 'Date' },
    { key: 'size', label: 'Size' },
    { key: 'type', label: 'Type' }
  ];

  const chipClass = (active: boolean) =>
    `px-3 py-1 text-sm rounded-full transition-colors ${
      active ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
    }`;

  // Filter + sort controls: a toggled panel on mobile, always visible in the
  // side panel on desktop
  const filterControls = (
    <div className="space-y-3">
      <div>
        <p className="text-xs text-slate-400 mb-2">Filter</p>
        <div className="flex flex-wrap gap-2">
          {filterOptions.filter(opt => opt.group === 'general').map((opt) => (
            <button key={opt.key} onClick={() => setFilterMode(opt.key)} className={chipClass(filterMode === opt.key)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-400 mb-2">Audio Format</p>
        <div className="flex flex-wrap gap-2">
          {filterOptions.filter(opt => opt.group === 'format').map((opt) => (
            <button key={opt.key} onClick={() => setFilterMode(opt.key)} className={chipClass(filterMode === opt.key)}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs text-slate-400 mb-2">Sort by</p>
        <div className="flex flex-wrap gap-2">
          {sortOptions.map((opt) => (
            <button
              key={opt.key}
              onClick={() => {
                if (sortBy === opt.key) {
                  setSortDesc(!sortDesc);
                } else {
                  setSortBy(opt.key);
                  setSortDesc(false);
                }
              }}
              className={chipClass(sortBy === opt.key)}
            >
              {opt.label} {sortBy === opt.key && (sortDesc ? '↓' : '↑')}
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  const refreshRunning = refreshJob?.phase === 'running' || (!refreshJob && !!stats?.isRefreshing);

  const fileExtension = (file: ChannelFile) => {
    if (file.category === 'Folder') return 'Folder';
    const dot = file.name.lastIndexOf('.');
    return dot > 0 ? file.name.slice(dot + 1).toUpperCase() : file.type || '';
  };

  return (
    <div className="flex flex-col h-screen lg:h-full">
      <Header
        title={channel?.name || 'Channel'}
        subtitle={channel ? `${totalCount} files${stats ? ` · ${stats.totalSizeText} indexed` : ''}` : undefined}
        showBack
        backPath="/channels"
        actions={
          <button
            onClick={() => setShowRefreshDialog(true)}
            disabled={refreshRunning || !channel}
            className="p-2 text-slate-400 hover:text-white transition-colors disabled:opacity-60"
            aria-label="Refresh channel"
            title={refreshRunning ? 'Refreshing channel...' : 'Refresh channel from Telegram'}
          >
            <RefreshCw className={`w-5 h-5 ${refreshRunning ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        }
      />

      <div className="flex-1 min-h-0 flex">
        {/* Desktop side panel: channel info, refresh and filters */}
        <aside className="hidden lg:block w-72 xl:w-80 shrink-0 border-r border-slate-700 overflow-y-auto">
          <ChannelInfoPanel
            channel={channel}
            stats={stats}
            job={refreshJob}
            onRefresh={() => setShowRefreshDialog(true)}
          >
            {filterControls}
          </ChannelInfoPanel>
        </aside>

        <div className="flex-1 min-w-0 flex flex-col">
          {/* Mobile refresh progress */}
          {refreshRunning && (
            <div className="lg:hidden flex items-center gap-2 px-4 py-2 text-xs text-emerald-300 bg-emerald-500/10 border-b border-slate-700">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Refreshing channel on the server. The list reloads when it finishes.
            </div>
          )}

          {/* Selection bar replaces the toolbar while selecting */}
          {selection.selectionMode ? (
            <SelectionBar
              count={selection.selectedCount}
              total={files.length}
              busy={bulkBusy}
              busyLabel={bulkLabel}
              onSelectAll={() => selection.selectAll(files)}
              onDeselectAll={selection.deselectAll}
              onAddToPlaylist={handleBulkAddToPlaylist}
              onDownload={handleBulkDownload}
              onPlayNext={handleBulkPlayNext}
              onCancel={selection.exitSelection}
            />
          ) : (
          /* Toolbar */
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 border-b border-slate-700">
            {/* Search toggle */}
            <button
              onClick={() => setShowSearch(!showSearch)}
              className={`p-2 rounded-lg transition-colors ${showSearch ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300'}`}
              title="Search"
            >
              <Search className="w-5 h-5" />
            </button>

            {/* Filter toggle (desktop shows the filters in the side panel) */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`lg:hidden p-2 rounded-lg transition-colors ${showFilters ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300'}`}
            >
              <SlidersHorizontal className="w-5 h-5" />
            </button>

            {/* Enter selection mode without a long press (mouse users) */}
            <button
              onClick={() => files[0] && selection.startWith(files[0])}
              disabled={files.length === 0}
              className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600 disabled:opacity-50"
              title="Select files (or Ctrl+click)"
            >
              <ListChecks className="w-4 h-4" />
              Select
            </button>

            {/* Current filter badge */}
            <span className="px-3 py-1 text-xs bg-slate-700 rounded-full text-slate-300">
              {filterOptions.find(f => f.key === filterMode)?.label}
            </span>

            <div className="flex-1" />

            {/* Play all button */}
            <button
              onClick={playAllAudio}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium"
            >
              <Play className="w-4 h-4" fill="currentColor" />
              Play All
            </button>
          </div>
          )}

          {/* Search bar */}
          {showSearch && !selection.selectionMode && (
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 border-b border-slate-700">
              <Search className="w-5 h-5 text-slate-400" />
              <input
                type="text"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Search files..."
                className="flex-1 bg-transparent text-white placeholder-slate-400 outline-none"
                autoFocus
              />
              {searchText && (
                <button onClick={() => setSearchText('')} className="p-1 text-slate-400">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {/* Filters panel (mobile) */}
          {showFilters && !selection.selectionMode && (
            <div className="lg:hidden px-4 py-3 bg-slate-800 border-b border-slate-700">
              {filterControls}
            </div>
          )}

          {/* Breadcrumb */}
          {folderPath.length > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 text-sm overflow-x-auto no-scrollbar bg-slate-800/50">
              <button
                onClick={() => navigateToFolder(-1)}
                className="text-emerald-400 hover:underline whitespace-nowrap"
              >
                Root
              </button>
              {folderPath.map((folder, index) => (
                <div key={folder.id} className="flex items-center gap-2">
                  <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" />
                  <button
                    onClick={() => navigateToFolder(index)}
                    className={`whitespace-nowrap ${index === folderPath.length - 1 ? 'text-white' : 'text-emerald-400 hover:underline'}`}
                  >
                    {folder.name}
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Desktop column headers */}
          {!loading && files.length > 0 && (
            <div className="hidden lg:flex items-center gap-4 px-4 py-2 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-700">
              {selection.selectionMode && <span className="w-5 shrink-0" />}
              <span className="w-10 shrink-0" />
              <span className="flex-1">Name</span>
              <span className="w-16 shrink-0">Type</span>
              <span className="w-20 shrink-0 text-right">Size</span>
              <span className="hidden xl:block w-28 shrink-0">Date</span>
              <span className="w-[7.5rem] shrink-0" />
            </div>
          )}

          {/* Files List with infinite scroll */}
          <div ref={listRef} className="flex-1 overflow-y-auto">
            {loading ? (
              <LoadingScreen message="Loading files..." />
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Folder className="w-12 h-12 mb-4 opacity-50" />
                <p>No files found</p>
                <p className="text-sm mt-2">Try changing the filter or refreshing the channel</p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-slate-700">
                  {files.map((file) => {
                    const selected = selection.isSelected(file);
                    const fileDate = file.dateModified || file.dateCreated;
                    return (
                    <div
                      key={`${file.category}-${file.id}`}
                      onClick={(e) => handleFileClick(file, e)}
                      onTouchStart={(e) => handleLongPressStart(file, e)}
                      onTouchMove={handleLongPressMove}
                      onTouchEnd={handleLongPressEnd}
                      onMouseDown={(e) => handleLongPressStart(file, e)}
                      onMouseUp={handleLongPressEnd}
                      onMouseLeave={handleLongPressEnd}
                      className={`group w-full flex items-center gap-4 p-4 lg:py-2.5 transition-colors touch-manipulation text-left cursor-pointer select-none ${
                        selected ? 'bg-emerald-500/15' : 'hover:bg-slate-800'
                      }`}
                    >
                      {selection.selectionMode && (
                        <div className="flex-shrink-0 text-emerald-400">
                          {selected ? (
                            <CheckCircle2 className="w-5 h-5" />
                          ) : (
                            <Circle className="w-5 h-5 text-slate-500" />
                          )}
                        </div>
                      )}
                      <div
                        className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 relative ${
                          file.category === 'Folder'
                            ? 'bg-yellow-500/20 text-yellow-400'
                            : 'bg-emerald-500/20 text-emerald-400'
                        }`}
                      >
                        {categoryIcons[file.category] || <Music className="w-5 h-5" />}
                        {/* Cache indicator */}
                        {cachedTrackIds.has(file.id) && (
                          <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                            <Check className="w-2.5 h-2.5 text-white" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-white truncate" title={file.name}>{file.name}</p>
                        <p className="text-xs text-slate-400 lg:hidden">
                          {file.category !== 'Folder' && formatFileSize(file.size)}
                        </p>
                      </div>

                      {/* Desktop columns */}
                      <span className="hidden lg:block w-16 shrink-0 text-xs text-slate-400 truncate">{fileExtension(file)}</span>
                      <span className="hidden lg:block w-20 shrink-0 text-xs text-slate-400 text-right tabular-nums">
                        {file.category !== 'Folder' ? formatFileSize(file.size) : ''}
                      </span>
                      <span className="hidden xl:block w-28 shrink-0 text-xs text-slate-400 tabular-nums">
                        {fileDate ? formatDate(fileDate) : ''}
                      </span>

                      <div className="flex items-center justify-end lg:w-[7.5rem] shrink-0">
                        {file.category === 'Audio' && !selection.selectionMode && (
                          <>
                            <button
                              onClick={(e) => handlePlayNextFile(file, e)}
                              className="hidden lg:block p-2 text-slate-500 hover:text-emerald-400 transition-colors lg:opacity-0 lg:group-hover:opacity-100"
                              title="Play next"
                            >
                              <ListPlus className="w-5 h-5" />
                            </button>
                            {!cachedTrackIds.has(file.id) && (
                              activeDownloads.has(file.id) ? (
                                <span className="p-2 text-amber-400 text-xs tabular-nums">
                                  {activeDownloads.get(file.id)}%
                                </span>
                              ) : (
                                <button
                                  onClick={(e) => handleDownload(file, e)}
                                  className="p-2 text-slate-500 hover:text-emerald-400 transition-colors"
                                  title="Download"
                                >
                                  <Download className="w-5 h-5" />
                                </button>
                              )
                            )}
                            <button
                              onClick={(e) => handleAddToPlaylist(file, e)}
                              className="p-2 text-slate-500 hover:text-emerald-400 transition-colors"
                              title="Add to playlist"
                            >
                              <Plus className="w-5 h-5" />
                            </button>
                          </>
                        )}
                        {file.category === 'Folder' && !selection.selectionMode && (
                          <ChevronRight className="w-5 h-5 text-slate-500" />
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>

                {/* Loading more indicator */}
                {loadingMore && (
                  <div className="flex items-center justify-center py-4 gap-2 text-slate-400">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span className="text-sm">Loading more...</span>
                  </div>
                )}

                {/* Stats */}
                <div className="py-3 text-center text-xs text-slate-500">
                  {files.length} of {totalCount} files
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Playlist Picker Modal (one track or a whole selection) */}
      {pickerTracks && (
        <PlaylistPicker
          tracks={pickerTracks}
          onClose={() => setPickerTracks(null)}
          onAdded={selection.exitSelection}
        />
      )}

      {showRefreshDialog && channel && (
        <RefreshChannelDialog
          channelId={id!}
          channelName={channel.name}
          stats={stats}
          onClose={() => setShowRefreshDialog(false)}
        />
      )}
    </div>
  );
}
