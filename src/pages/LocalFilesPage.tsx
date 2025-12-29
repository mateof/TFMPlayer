import { useState, useEffect, useRef, useCallback } from 'react';
import { useSearchParams, useLocation } from 'react-router-dom';
import { Music, Folder, Play, Plus, ChevronRight, Download, Search, SlidersHorizontal, X, Loader2, Check, HardDrive } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { LoadingScreen } from '@/components/common/Spinner';
import { PlaylistPicker } from '@/components/playlists/PlaylistPicker';
import { localFilesApi } from '@/services/api/localFiles.api';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useDebounce } from '@/hooks/useDebounce';
import { useUiStore } from '@/stores/uiStore';
import { formatFileSize } from '@/utils/format';
import { downloadManager, useDownloadStore } from '@/services/download/DownloadManager';
import { cacheService } from '@/services/cache/CacheService';
import type { ChannelFile, Track } from '@/types/models';

const PAGE_SIZE = 50;

type FilterMode = 'audio_folders' | 'audio' | 'mp3' | 'flac' | 'wav' | 'ogg' | 'aac' | 'm4a' | 'wma' | 'ape' | 'opus';
type SortBy = 'name' | 'date' | 'size' | 'type';

const categoryIcons: Record<string, React.ReactNode> = {
  Audio: <Music className="w-5 h-5" />,
  Folder: <Folder className="w-5 h-5" />
};

// Convert ChannelFile to Track for local files
async function fileToTrack(file: ChannelFile): Promise<Track> {
  const streamUrl = await localFilesApi.getStreamUrl(file.path);
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
    streamUrl: streamUrl,
    title: file.name.replace(/\.[^/.]+$/, '')
  };
}

export function LocalFilesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const { addToast, getScrollPosition } = useUiStore();
  const { play } = useAudioPlayer();
  const activeDownloads = useDownloadStore((state) => state.activeDownloads);

  // State
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [files, setFiles] = useState<ChannelFile[]>([]);
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [selectedTrack, setSelectedTrack] = useState<Track | null>(null);
  const [cachedTrackIds, setCachedTrackIds] = useState<Set<string>>(new Set());

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // Filters
  const [filterMode, setFilterMode] = useState<FilterMode>('audio_folders');
  const [sortBy, setSortBy] = useState<SortBy>('name');
  const [sortDesc, setSortDesc] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showFilters, setShowFilters] = useState(false);

  // Debounce search text (0.7 seconds)
  const debouncedSearchText = useDebounce(searchText, 700);

  // Refs for infinite scroll
  const listRef = useRef<HTMLDivElement>(null);
  const loadingRef = useRef(false);

  // Get current path from URL params
  const pathParam = searchParams.get('path') || '';

  // Audio extensions for client-side filtering
  const audioExtensions = ['mp3', 'flac', 'wav', 'ogg', 'opus', 'aac', 'm4a', 'wma', 'ape'];
  const isExtensionFilter = audioExtensions.includes(filterMode);

  // Get the API filter value
  const getApiFilter = (): string | undefined => {
    if (filterMode === 'audio_folders') return 'audio_folders';
    if (filterMode === 'audio' || isExtensionFilter) return 'audio';
    return 'audio_folders';
  };

  // Filter files by extension on the client side
  const filterByExtension = (fileList: ChannelFile[]): ChannelFile[] => {
    if (!Array.isArray(fileList)) return [];
    if (!isExtensionFilter) return fileList;

    const ext = `.${filterMode.toLowerCase()}`;
    return fileList.filter(f =>
      f.category === 'Folder' ||
      f.name.toLowerCase().endsWith(ext)
    );
  };

  // Files are sorted by the server - no client-side sorting needed
  // When sortBy/sortDesc changes, we reload from page 1 with new sort params

  // Reset pagination when path, filter, search, or sort changes
  useEffect(() => {
    setCurrentPage(1);
    setFiles([]);
    setHasMore(true);
  }, [pathParam, filterMode, debouncedSearchText, sortBy, sortDesc]);

  // Load files when parameters change
  useEffect(() => {
    loadFiles(1, true);
  }, [pathParam, filterMode, debouncedSearchText, sortBy, sortDesc]);

  // Restore scroll position when returning from player
  useEffect(() => {
    if (!loading && files.length > 0) {
      const savedPosition = getScrollPosition(location.pathname);
      if (savedPosition > 0) {
        setTimeout(() => {
          window.scrollTo(0, savedPosition);
        }, 100);
      }
    }
  }, [loading, files.length, location.pathname, getScrollPosition]);

  // Refresh cache status when downloads complete
  useEffect(() => {
    if (!files.length) return;

    const audioFiles = files.filter(f => f.category === 'Audio');
    if (audioFiles.length === 0) return;

    const interval = setInterval(async () => {
      if (activeDownloads.size > 0) {
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

  const loadFiles = async (page: number, reset: boolean = false) => {
    if (loadingRef.current) return;
    loadingRef.current = true;

    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const result = await localFilesApi.getFiles(pathParam, {
        page,
        pageSize: PAGE_SIZE,
        filter: getApiFilter(),
        search: searchText || undefined,
        sortBy,
        sortDesc
      });

      // Apply client-side extension filtering
      const filteredData = filterByExtension(result.files);

      setCurrentPath(result.currentPath);
      setParentPath(result.parentPath);

      if (reset) {
        setFiles(filteredData);
        setTotalCount(result.totalCount);
        setHasMore(result.hasMore);
        setCurrentPage(page);
      } else {
        // For pagination, deduplicate files by ID before appending
        const currentFiles = files;
        const existingIds = new Set(currentFiles.map(f => f.id));
        const newUniqueFiles = filteredData.filter(f => !existingIds.has(f.id));

        // If no new unique files, stop loading more
        if (newUniqueFiles.length === 0) {
          console.log('No new unique files, stopping pagination');
          setHasMore(false);
        } else {
          setFiles([...currentFiles, ...newUniqueFiles]);
          // Use server's hasMore flag, but also check for duplicates
          setHasMore(result.hasMore && newUniqueFiles.length > 0);
          setCurrentPage(page);
        }
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
    const threshold = 200;

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
      const params = new URLSearchParams(searchParams);
      params.set('path', file.path);
      setSearchParams(params);
    } else if (file.category === 'Audio') {
      playAudioFile(file);
    }
  };

  const navigateToParent = () => {
    if (parentPath !== null) {
      const params = new URLSearchParams(searchParams);
      if (parentPath) {
        params.set('path', parentPath);
      } else {
        params.delete('path');
      }
      setSearchParams(params);
    }
  };

  const playAudioFile = async (file: ChannelFile) => {
    const audioFiles = files.filter(f => f.category === 'Audio');
    const tracks = await Promise.all(audioFiles.map(f => fileToTrack(f)));
    const startIndex = audioFiles.findIndex(f => f.id === file.id);
    const track = await fileToTrack(file);
    play(track, tracks, startIndex >= 0 ? startIndex : 0);
  };

  const playAllAudio = async () => {
    const audioFiles = files.filter(f => f.category === 'Audio');
    if (audioFiles.length === 0) {
      addToast('No audio files to play', 'info');
      return;
    }
    const tracks = await Promise.all(audioFiles.map(f => fileToTrack(f)));
    play(tracks[0], tracks, 0);
  };

  const handleAddToPlaylist = async (file: ChannelFile, e: React.MouseEvent) => {
    e.stopPropagation();
    const track = await fileToTrack(file);
    setSelectedTrack(track);
  };

  const handleDownload = async (file: ChannelFile, e: React.MouseEvent) => {
    e.stopPropagation();
    const track = await fileToTrack(file);
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

  // Get folder name from path
  const folderName = currentPath ? currentPath.split(/[/\\]/).pop() || 'Local Files' : 'Local Files';

  return (
    <div className="flex flex-col h-screen">
      <Header
        title={folderName}
        subtitle={`${totalCount} files`}
        showBack
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

      {/* Breadcrumb / Parent navigation */}
      {pathParam && (
        <div className="flex items-center gap-2 px-4 py-2 text-sm bg-slate-800/50 border-b border-slate-700">
          <button
            onClick={navigateToParent}
            className="flex items-center gap-2 text-emerald-400 hover:underline"
          >
            <HardDrive className="w-4 h-4" />
            <span>← Back</span>
          </button>
          <span className="text-slate-500">|</span>
          <span className="text-slate-400 truncate">{currentPath}</span>
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
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          playAudioFile(file);
                        }}
                        className="p-2 text-slate-500 hover:text-emerald-400 transition-colors"
                        title="Play"
                      >
                        <Play className="w-5 h-5" />
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
