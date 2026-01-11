import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useSearchParams, useLocation } from 'react-router-dom';
import { Music, Folder, Play, Plus, ChevronRight, Download, Search, SlidersHorizontal, X, Loader2, Check } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { LoadingScreen } from '@/components/common/Spinner';
import { PlaylistPicker } from '@/components/playlists/PlaylistPicker';
import { channelsApi } from '@/services/api/channels.api';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useDebounce } from '@/hooks/useDebounce';
import { useUiStore } from '@/stores/uiStore';
import { formatFileSize } from '@/utils/format';
import { buildStreamUrlSync } from '@/services/api/client';
import { downloadManager, useDownloadStore } from '@/services/download/DownloadManager';
import { cacheService } from '@/services/cache/CacheService';
import type { ChannelDetail, ChannelFile, Track } from '@/types/models';

const PAGE_SIZE = 50;

type FilterMode = 'audio_folders' | 'audio' | 'mp3' | 'flac' | 'wav' | 'ogg' | 'aac' | 'm4a' | 'wma' | 'ape' | 'opus';
type SortBy = 'name' | 'date' | 'size' | 'type';

const categoryIcons: Record<string, React.ReactNode> = {
  Audio: <Music className="w-5 h-5" />,
  Folder: <Folder className="w-5 h-5" />
};

// Convert ChannelFile to Track
function fileToTrack(file: ChannelFile, channelId: string, channelName: string): Track {
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

interface FolderBreadcrumb {
  id: string;
  name: string;
}

export function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { addToast, getScrollPosition } = useUiStore();
  const { play } = useAudioPlayer();
  const activeDownloads = useDownloadStore((state) => state.activeDownloads);
  const completedDownloads = useDownloadStore((state) => state.completedDownloads);
  const clearCompleted = useDownloadStore((state) => state.clearCompleted);

  // State
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [channel, setChannel] = useState<ChannelDetail | null>(null);
  const [files, setFiles] = useState<ChannelFile[]>([]);
  const [folderPath, setFolderPath] = useState<FolderBreadcrumb[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [cachedTrackIds, setCachedTrackIds] = useState<Set<string>>(new Set());

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
    } catch (error) {
      addToast('Failed to load channel', 'error');
      console.error(error);
    }
  };

  // Audio extensions for client-side filtering
  const audioExtensions = ['mp3', 'flac', 'wav', 'ogg', 'opus', 'aac', 'm4a', 'wma', 'ape'];
  const isExtensionFilter = audioExtensions.includes(filterMode);

  // Get the API filter value (send 'audio' for extension filters)
  const getApiFilter = (): string | undefined => {
    if (filterMode === 'audio_folders') return 'audio_folders';
    if (filterMode === 'audio' || isExtensionFilter) return 'audio';
    return 'audio_folders'; // Default to audio + folders
  };

  // Filter files by extension on the client side
  const filterByExtension = (files: ChannelFile[]): ChannelFile[] => {
    if (!isExtensionFilter) return files;

    const ext = `.${filterMode.toLowerCase()}`;
    return files.filter(f =>
      f.category === 'Folder' ||
      f.name.toLowerCase().endsWith(ext)
    );
  };

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
          filter: getApiFilter(),
          search: searchText || undefined,
          sortBy,
          sortDesc
        }
      );

      // Apply client-side extension filtering (sorting is done via useMemo)
      const filteredData = filterByExtension(data);

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

  const handleFileClick = (file: ChannelFile) => {
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

  const playAudioFile = (file: ChannelFile) => {
    if (!channel) return;

    const audioFiles = files.filter(f => f.category === 'Audio');
    const tracks = audioFiles.map(f => fileToTrack(f, id!, channel.name));
    const startIndex = audioFiles.findIndex(f => f.id === file.id);

    const track = fileToTrack(file, id!, channel.name);
    play(track, tracks, startIndex >= 0 ? startIndex : 0);
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
  };

  const handleAddToPlaylist = (file: ChannelFile, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!channel) return;
    const track = fileToTrack(file, id!, channel.name);
    setSelectedTrack(track);
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

  return (
    <div className="flex flex-col h-screen">
      <Header
        title={channel?.name || 'Channel'}
        subtitle={channel ? `${totalCount} files` : undefined}
        showBack
        backPath="/channels"
      />

      {/* Toolbar */}
      <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 border-b border-slate-700">
        {/* Search toggle */}
        <button
          onClick={() => setShowSearch(!showSearch)}
          className={`p-2 rounded-lg transition-colors ${showSearch ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300'}`}
        >
          <Search className="w-5 h-5" />
        </button>

        {/* Filter toggle */}
        <button
          onClick={() => setShowFilters(!showFilters)}
          className={`p-2 rounded-lg transition-colors ${showFilters ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300'}`}
        >
          <SlidersHorizontal className="w-5 h-5" />
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

      {/* Search bar */}
      {showSearch && (
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

      {/* Filters panel */}
      {showFilters && (
        <div className="px-4 py-3 bg-slate-800 border-b border-slate-700 space-y-3">
          {/* Filter mode - General */}
          <div>
            <p className="text-xs text-slate-400 mb-2">Filter</p>
            <div className="flex flex-wrap gap-2">
              {filterOptions.filter(opt => opt.group === 'general').map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setFilterMode(opt.key)}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    filterMode === opt.key
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Filter mode - Audio Formats */}
          <div>
            <p className="text-xs text-slate-400 mb-2">Audio Format</p>
            <div className="flex flex-wrap gap-2">
              {filterOptions.filter(opt => opt.group === 'format').map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setFilterMode(opt.key)}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    filterMode === opt.key
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Sort */}
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
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    sortBy === opt.key
                      ? 'bg-emerald-500 text-white'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  {opt.label} {sortBy === opt.key && (sortDesc ? '↓' : '↑')}
                </button>
              ))}
            </div>
          </div>
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

      {/* Files List with infinite scroll */}
      <div ref={listRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingScreen message="Loading files..." />
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-400">
            <Folder className="w-12 h-12 mb-4 opacity-50" />
            <p>No files found</p>
            <p className="text-sm mt-2">Try changing the filter</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-slate-700">
              {files.map((file) => (
                <div
                  key={`${file.category}-${file.id}`}
                  onClick={() => handleFileClick(file)}
                  className="w-full flex items-center gap-4 p-4 hover:bg-slate-800 transition-colors touch-manipulation text-left cursor-pointer"
                >
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
                    <p className="text-sm text-white truncate">{file.name}</p>
                    <p className="text-xs text-slate-400">
                      {file.category !== 'Folder' && formatFileSize(file.size)}
                    </p>
                  </div>
                  {file.category === 'Audio' && (
                    <>
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
                  {file.category === 'Folder' && (
                    <ChevronRight className="w-5 h-5 text-slate-500" />
                  )}
                </div>
              ))}
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

      {/* Playlist Picker Modal */}
      {selectedTrack && (
        <PlaylistPicker
          track={selectedTrack}
          onClose={() => setSelectedTrack(null)}
        />
      )}
    </div>
  );
}
