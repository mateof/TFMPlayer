import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  Music, Folder, Play, Plus, ChevronRight, Download, Search, SlidersHorizontal, X,
  Loader2, Check, CheckCircle2, Circle, ListPlus, ListChecks, FolderCog, FolderPlus, Upload,
  LayoutGrid, List as ListIcon, MoreVertical, Eye, ServerCog, Zap, Share2, Pencil, Scissors,
  Copy, Trash2, FileJson, RefreshCw
} from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { LoadingScreen } from '@/components/common/Spinner';
import { SelectionBar } from '@/components/common/SelectionBar';
import { PlaylistPicker } from '@/components/playlists/PlaylistPicker';
import { FileFilterControls } from '@/components/files/FileFilterControls';
import { FileThumb } from '@/components/files/manage/FileIcon';
import { FileGrid } from '@/components/files/manage/FileGrid';
import { FileDetailsSheet, type EntryAction } from '@/components/files/manage/FileDetailsSheet';
import { FolderPickerDialog } from '@/components/files/manage/FolderPickerDialog';
import { MediaViewer } from '@/components/files/manage/MediaViewer';
import { NameDialog } from '@/components/files/manage/NameDialog';
import { ManageSelectionBar, PasteBar } from '@/components/files/manage/ManageBars';
import { UploadPanel } from '@/components/files/manage/UploadPanel';
import { FILTER_OPTIONS, useFileFilters, type FileFilters } from '@/hooks/useFileFilters';
import { useManageMode } from '@/hooks/useManageMode';
import { useFileOperations } from '@/hooks/useFileOperations';
import { useMultiSelect } from '@/hooks/useMultiSelect';
import { useLongPress } from '@/hooks/useLongPress';
import { useCachedTrackIds } from '@/hooks/useCachedTrackIds';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useMediaQuery, DESKTOP_QUERY } from '@/hooks/useMediaQuery';
import { useUiStore } from '@/stores/uiStore';
import { useDownloadStore, downloadManager } from '@/services/download/DownloadManager';
import { canPaste, useFileClipboard } from '@/services/files/clipboard';
import {
  MANAGE_FILTER_LABELS, viewerKind,
  type FileManagerTarget, type FolderContext, type FolderRef, type ManageOperation, type ManagePage
} from '@/services/files/fileManager';
import { filterFilesByExtension, getApiFilter } from '@/utils/channelTracks';
import { dedupeTracks, MAX_SELECTION_TRACKS } from '@/utils/collectTracks';
import { setDragPayload, type DragItem } from '@/utils/dragTracks';
import { formatDate, formatFileSize } from '@/utils/format';
import type { ChannelFile, Track } from '@/types/models';
import { t } from '@/i18n';

export const FILE_PAGE_SIZE = 50;

export interface FilePageParams {
  pageSize: number;
  filter: string;
  search?: string;
  sortBy: string;
  sortDesc: boolean;
}

export interface FilePage {
  files: ChannelFile[];
  totalCount: number;
  hasMore: boolean;
}

/** Where the files come from: a Telegram channel or the server's local disk. */
export interface FileSource {
  /** Query-key prefix, e.g. `channel:123` or `local`. */
  key: string;
  /** Current folder (id or path); '' is the root. */
  location: string;
  fetchPage: (page: number, params: FilePageParams) => Promise<FilePage>;
  toTrack: (file: ChannelFile) => Track;
  collectFolder: (file: ChannelFile, onProgress: (found: number) => void) => Promise<Track[]>;
  folderDragItem: (file: ChannelFile) => DragItem;
}

export interface QueueStartContext {
  filters: FileFilters;
  nextPage: number;
  hasMore: boolean;
}

interface FileBrowserProps {
  source: FileSource;
  title: string;
  subtitle?: (totalCount: number) => string | undefined;
  backPath: string;
  headerActions?: ReactNode;
  breadcrumbs: string[];
  /** -1 = root, otherwise the index in `breadcrumbs`. */
  onNavigateBreadcrumb: (index: number) => void;
  onOpenFolder: (file: ChannelFile) => void;
  /** Called after playback starts from this list (to page the queue in later). */
  onQueueStarted?: (ctx: QueueStartContext) => void;
  /** Desktop side panel; receives the filter controls to place inside. */
  sidePanel?: (filterControls: ReactNode) => ReactNode;
  banner?: ReactNode;
  emptyHint?: string;
  /**
   * Manage mode (every file type, file operations, viewers) through the v1
   * API. Only passed when the server supports it; without it the browser is
   * the audio-only one.
   */
  manager?: FileManagerTarget | null;
  /** Always in Manage mode and never plays into the queue (shared collections). */
  manageOnly?: boolean;
}

// Folders and files come from different id spaces, so key them by both
const fileKey = (file: ChannelFile) => `${file.category}:${file.id}`;

// Scroll offsets per list (source + folder + filters), so coming back from
// the player or a subfolder lands where the user was
const scrollOffsets = new Map<string, number>();

const ROW_HEIGHT_MOBILE = 65;
const ROW_HEIGHT_DESKTOP = 57;

const categoryIcons: Record<string, ReactNode> = {
  Audio: <Music className="w-5 h-5" aria-hidden />,
  Folder: <Folder className="w-5 h-5" aria-hidden />
};

function fileExtension(file: ChannelFile): string {
  if (file.category === 'Folder') return t('Folder');
  const dot = file.name.lastIndexOf('.');
  return dot > 0 ? file.name.slice(dot + 1).toUpperCase() : file.type || '';
}

type NameDialogState = { mode: 'create' } | { mode: 'rename'; file: ChannelFile } | null;

/**
 * Paged, virtualized file list with search, filters, multi-selection, bulk
 * actions and desktop drag and drop. Used by the channel, local and shared
 * collection pages. With a `manager` it also has a Manage mode: every file
 * type, list/grid view, details, viewers and file operations.
 */
export function FileBrowser({
  source,
  title,
  subtitle,
  backPath,
  headerActions,
  breadcrumbs,
  onNavigateBreadcrumb,
  onOpenFolder,
  onQueueStarted,
  sidePanel,
  banner,
  emptyHint = t('Try changing the filter'),
  manager = null,
  manageOnly = false
}: FileBrowserProps) {
  const addToast = useUiStore((s) => s.addToast);
  const { play, playNext } = useAudioPlayer();
  const activeDownloads = useDownloadStore((s) => s.activeDownloads);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const filters = useFileFilters();
  const { filterMode, sortBy, sortDesc, searchText, debouncedSearch, setSearchText } = filters;
  const manageMode = useManageMode(manageOnly);
  const manageActive = !!manager && manageMode.manage;
  const ops = manageActive ? manager.operations : NO_OPS;
  const grid = manageActive && manageMode.viewMode === 'grid';

  const [showSearch, setShowSearch] = useState(!!searchText);
  const [showFilters, setShowFilters] = useState(false);
  const [pickerTracks, setPickerTracks] = useState<Track[] | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkLabel, setBulkLabel] = useState('');
  const [detailsFile, setDetailsFile] = useState<ChannelFile | null>(null);
  const [viewerStart, setViewerStart] = useState<string | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null);
  const [folderPicker, setFolderPicker] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const selection = useMultiSelect<ChannelFile>(fileKey);
  const clip = useFileClipboard((s) => s.clip);

  // ---- Data -----------------------------------------------------------------

  const query = useInfiniteQuery<FilePage | ManagePage>({
    queryKey: manageActive
      ? ['manage-files', manager.key, source.location, manageMode.typeFilter, debouncedSearch, sortBy, sortDesc]
      : ['files', source.key, source.location, filterMode, debouncedSearch, sortBy, sortDesc],
    queryFn: ({ pageParam, signal }) =>
      manageActive
        ? manager.list(source.location, pageParam as number, {
          pageSize: FILE_PAGE_SIZE,
          filter: manageMode.typeFilter,
          search: debouncedSearch || undefined,
          sortBy,
          sortDesc
        }, signal)
        : source.fetchPage(pageParam as number, {
          pageSize: FILE_PAGE_SIZE,
          filter: getApiFilter(filterMode),
          search: debouncedSearch || undefined,
          sortBy,
          sortDesc
        }),
    initialPageParam: 1,
    getNextPageParam: (last, _all, lastParam) =>
      last.hasMore && last.files.length > 0 ? (lastParam as number) + 1 : undefined
  });

  const files = useMemo(() => {
    const seen = new Set<string>();
    const merged: ChannelFile[] = [];
    for (const page of query.data?.pages ?? []) {
      for (const file of page.files) {
        const key = fileKey(file);
        if (seen.has(key)) continue; // servers sometimes repeat across pages
        seen.add(key);
        merged.push(file);
      }
    }
    return manageActive ? merged : filterFilesByExtension(merged, filterMode);
  }, [query.data, filterMode, manageActive]);

  const totalCount = query.data?.pages[0]?.totalCount ?? 0;
  const loadedPages = query.data?.pages.length ?? 0;
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query;
  const firstPage = query.data?.pages[0] as ManagePage | undefined;
  const currentPath = firstPage?.currentPath ?? '';
  const folderCtx = useMemo<FolderContext>(() => ({ location: source.location, currentPath }), [source.location, currentPath]);
  const fileOps = useFileOperations(manageActive ? manager : null, folderCtx);

  useEffect(() => {
    if (query.isError && !query.data) addToast(t('Failed to load files'), 'error');
  }, [query.isError, query.data, addToast]);

  const audioFiles = useMemo(() => files.filter((f) => f.category === 'Audio'), [files]);
  const audioIds = useMemo(() => audioFiles.map((f) => f.id), [audioFiles]);
  const cachedTrackIds = useCachedTrackIds(audioIds);
  // Gallery of the viewer: what can be shown in the app, in list order (audio
  // plays in the player instead, except in read-only collections)
  const viewables = useMemo(
    () => (manageActive ? files.filter((f) => {
      const kind = viewerKind(f);
      return kind !== null && (kind !== 'audio' || manageOnly);
    }) : []),
    [files, manageActive, manageOnly]
  );

  // ---- Virtual list -----------------------------------------------------------

  const listRef = useRef<HTMLDivElement>(null);
  const scrollKey = `${manageActive ? 'm' : ''}${source.key}|${source.location}|${filterMode}|${manageMode.typeFilter}|${debouncedSearch}|${sortBy}|${sortDesc}|${grid}`;
  const rowHeight = isDesktop ? ROW_HEIGHT_DESKTOP : ROW_HEIGHT_MOBILE;

  const virtualizer = useVirtualizer({
    count: grid ? 0 : files.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => rowHeight,
    overscan: 10,
    initialOffset: () => scrollOffsets.get(scrollKey) ?? 0
  });

  const virtualItems = virtualizer.getVirtualItems();
  const lastVisibleIndex = virtualItems.length > 0 ? virtualItems[virtualItems.length - 1].index : -1;

  // Infinite scroll: fetch the next page when the end comes into view
  useEffect(() => {
    if (!grid && hasNextPage && !isFetchingNextPage && lastVisibleIndex >= files.length - 10) {
      fetchNextPage();
    }
  }, [grid, lastVisibleIndex, files.length, hasNextPage, isFetchingNextPage, fetchNextPage]);

  const loadMoreForGrid = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const handleListScroll = () => {
    if (listRef.current) scrollOffsets.set(scrollKey, listRef.current.scrollTop);
  };

  // Keyboard: move focus between rows, scrolling virtual ones into existence
  const focusRow = (index: number) => {
    if (index < 0 || index >= files.length) return;
    virtualizer.scrollToIndex(index, { align: 'auto' });
    requestAnimationFrame(() => {
      listRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)?.focus();
    });
  };

  // ---- Actions ----------------------------------------------------------------

  const startQueue = (startFile?: ChannelFile) => {
    if (audioFiles.length === 0) {
      addToast(t('No audio files to play'), 'info');
      return;
    }
    const tracks = audioFiles.map(source.toTrack);
    const index = startFile ? Math.max(0, audioFiles.findIndex((f) => f.id === startFile.id)) : 0;
    play(tracks[index], tracks, index);
    onQueueStarted?.({ filters, nextPage: loadedPages + 1, hasMore: !!hasNextPage });
  };

  const openViewer = (file: ChannelFile) => setViewerStart(fileKey(file));

  const setManage = (on: boolean) => {
    selection.exitSelection();
    manageMode.setManage(on);
  };

  const longPress = useLongPress<ChannelFile>(
    useCallback((file) => selection.startWith(file), [selection]),
    { enabled: !selection.selectionMode }
  );

  const activate = (file: ChannelFile, e?: React.MouseEvent | React.KeyboardEvent) => {
    // Desktop: Ctrl/Cmd+click selects like a file manager
    if (e && (e.ctrlKey || e.metaKey)) {
      if (selection.selectionMode) selection.toggle(file);
      else selection.startWith(file);
      return;
    }
    if (selection.selectionMode) {
      selection.toggle(file);
      return;
    }
    if (file.category === 'Folder') {
      onOpenFolder(file);
      return;
    }
    if (file.category === 'Audio' && !manageOnly) {
      startQueue(file);
      return;
    }
    if (manageActive) {
      if (viewerKind(file)) openViewer(file);
      else setDetailsFile(file);
    }
  };

  const handleRowClick = (file: ChannelFile, e: React.MouseEvent) => {
    if (longPress.consumeLongPress()) return;
    activate(file, e);
  };

  const handleRowKeyDown = (file: ChannelFile, index: number, e: React.KeyboardEvent) => {
    // Rows own these keys: keep them away from the global player shortcuts
    switch (e.key) {
      case 'Enter':
        e.preventDefault();
        e.stopPropagation();
        activate(file, e);
        break;
      case ' ':
        e.preventDefault();
        e.stopPropagation();
        if (selection.selectionMode) selection.toggle(file);
        else selection.startWith(file);
        break;
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        focusRow(index + 1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        focusRow(index - 1);
        break;
      case 'Home':
        e.preventDefault();
        focusRow(0);
        break;
      case 'End':
        e.preventDefault();
        focusRow(files.length - 1);
        break;
      case 'Escape':
        if (selection.selectionMode) {
          e.stopPropagation();
          selection.exitSelection();
        }
        break;
      case 'Delete':
        if (manageActive && ops.has('delete')) {
          e.preventDefault();
          const targets = selection.selectionMode && selection.isSelected(file) ? selectedFiles() : [file];
          fileOps.remove(targets).then((done) => done && selection.exitSelection());
        }
        break;
      case 'F2':
        if (manageActive && ops.has('rename')) {
          e.preventDefault();
          setNameDialog({ mode: 'rename', file });
        }
        break;
    }
  };

  const dragItemFor = (file: ChannelFile): DragItem | null => {
    if (manageOnly) return null;
    if (file.category === 'Audio') return { kind: 'track', track: source.toTrack(file) };
    if (file.category === 'Folder') return source.folderDragItem(file);
    return null;
  };

  const handleDragStart = (file: ChannelFile, e: React.DragEvent) => {
    // Dragging a selected row drags the whole selection
    const group = selection.selectionMode && selection.isSelected(file)
      ? files.filter((f) => selection.isSelected(f))
      : [file];
    const items = group.map(dragItemFor).filter((i): i is DragItem => i !== null);
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    setDragPayload(e, items);
  };

  const selectedFiles = () => files.filter((f) => selection.selectedKeys.has(fileKey(f)));

  const buildSelectedTracks = async (): Promise<Track[]> => {
    const selected = selectedFiles();
    const collected: Track[] = [];
    for (const file of selected) {
      if (file.category === 'Audio') {
        collected.push(source.toTrack(file));
      } else if (file.category === 'Folder') {
        setBulkLabel(t('Scanning "{name}"...', { name: file.name }));
        collected.push(...await source.collectFolder(file, (found) =>
          setBulkLabel(t('Scanning "{name}" - {count} tracks found', { name: file.name, count: found }))
        ));
      }
    }
    return dedupeTracks(collected);
  };

  const withSelectedTracks = async (action: (tracks: Track[]) => void | Promise<void>) => {
    setBulkBusy(true);
    setBulkLabel(t('Preparing...'));
    try {
      const tracks = await buildSelectedTracks();
      if (tracks.length === 0) {
        addToast(t('No audio in the selection'), 'info');
        return;
      }
      if (tracks.length >= MAX_SELECTION_TRACKS) {
        addToast(t('Selection capped at the first {count} tracks', { count: MAX_SELECTION_TRACKS }), 'warning');
      }
      await action(tracks);
    } catch (error) {
      console.error('Bulk action failed:', error);
      addToast(t('Could not complete the action'), 'error');
    } finally {
      setBulkBusy(false);
      setBulkLabel('');
    }
  };

  const handleBulkPlayNext = () =>
    withSelectedTracks((tracks) => {
      // Insert backwards so the selection keeps its order in the queue
      for (let i = tracks.length - 1; i >= 0; i--) playNext(tracks[i]);
      addToast(t('{count} track(s) will play next', { count: tracks.length }), 'success');
      selection.exitSelection();
    });

  const handleBulkDownload = () =>
    withSelectedTracks(async (tracks) => {
      await downloadManager.addMultipleToQueue(tracks);
      addToast(t('{count} track(s) queued for download', { count: tracks.length }), 'success');
      selection.exitSelection();
    });

  // Manage mode bulk operations: busy while the request runs
  const withBusy = async (action: () => Promise<unknown> | void, exitAfter = true) => {
    setBulkBusy(true);
    try {
      await action();
      if (exitAfter) selection.exitSelection();
    } finally {
      setBulkBusy(false);
    }
  };

  const pasteInto = (destination: FolderRef) => withBusy(() => fileOps.paste(destination), false);

  /** Actions of one entry, for its details sheet. */
  const entryActions = (file: ChannelFile): EntryAction[] => {
    const isFolder = file.category === 'Folder';
    const close = (fn: () => void) => () => {
      setDetailsFile(null);
      fn();
    };
    const actions: EntryAction[] = [];
    if (isFolder) {
      actions.push({ id: 'open', label: t('Open'), icon: <Folder className="w-4 h-4" aria-hidden />, onClick: close(() => onOpenFolder(file)) });
    } else if (file.category === 'Audio' && !manageOnly) {
      actions.push({ id: 'play', label: t('Play'), icon: <Play className="w-4 h-4" aria-hidden />, onClick: close(() => startQueue(file)) });
      actions.push({ id: 'playlist', label: t('Add to playlist'), icon: <Plus className="w-4 h-4" aria-hidden />, onClick: close(() => setPickerTracks([source.toTrack(file)])) });
    } else if (viewerKind(file)) {
      actions.push({ id: 'view', label: t('Open'), icon: <Eye className="w-4 h-4" aria-hidden />, onClick: close(() => openViewer(file)) });
    }
    if (!isFolder && ops.has('downloadToDevice')) {
      actions.push({ id: 'download', label: t('Download to this device'), icon: <Download className="w-4 h-4" aria-hidden />, onClick: close(() => fileOps.downloadToDevice([file])) });
    }
    if (ops.has('downloadToServer')) {
      actions.push({ id: 'server', label: t('Download to the server'), icon: <ServerCog className="w-4 h-4" aria-hidden />, onClick: close(() => fileOps.downloadToServer([file])) });
    }
    if (ops.has('preload')) {
      actions.push({ id: 'preload', label: t('Preload on the server'), icon: <Zap className="w-4 h-4" aria-hidden />, onClick: close(() => fileOps.preload([file])) });
    }
    if (!isFolder && ops.has('shareLink')) {
      actions.push({ id: 'link', label: t('Share link'), icon: <Share2 className="w-4 h-4" aria-hidden />, onClick: close(() => fileOps.shareLink(file)) });
    }
    if (isFolder && ops.has('exportShare')) {
      actions.push({ id: 'export', label: t('Export as share'), icon: <FileJson className="w-4 h-4" aria-hidden />, onClick: close(() => fileOps.exportShare(file, file.name)) });
    }
    if (ops.has('rename')) {
      actions.push({ id: 'rename', label: t('Rename'), icon: <Pencil className="w-4 h-4" aria-hidden />, onClick: close(() => setNameDialog({ mode: 'rename', file })) });
    }
    if (ops.has('move')) {
      actions.push({ id: 'cut', label: t('Cut'), icon: <Scissors className="w-4 h-4" aria-hidden />, onClick: close(() => fileOps.toClipboard('cut', [file])) });
    }
    if (ops.has('copy')) {
      actions.push({ id: 'copy', label: t('Copy'), icon: <Copy className="w-4 h-4" aria-hidden />, onClick: close(() => fileOps.toClipboard('copy', [file])) });
    }
    if (ops.has('delete')) {
      actions.push({ id: 'delete', label: t('Delete'), icon: <Trash2 className="w-4 h-4" aria-hidden />, danger: true, onClick: close(() => fileOps.remove([file])) });
    }
    return actions;
  };

  const onUploadPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.target.files ?? []);
    e.target.value = '';
    fileOps.upload(picked);
  };

  // Desktop: drop files from the computer onto the list to upload them
  const canUpload = manageActive && ops.has('upload');
  const dropHandlers = canUpload
    ? {
      onDragOver: (e: React.DragEvent) => {
        if (!e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDropActive(true);
      },
      onDragLeave: (e: React.DragEvent) => {
        if (e.currentTarget === e.target) setDropActive(false);
      },
      onDrop: (e: React.DragEvent) => {
        if (!e.dataTransfer.files?.length) return;
        e.preventDefault();
        setDropActive(false);
        fileOps.upload(Array.from(e.dataTransfer.files));
      }
    }
    : {};

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  // ---- Render -----------------------------------------------------------------

  const filterControls = (
    <FileFilterControls
      filters={filters}
      manage={manageActive ? { typeFilter: manageMode.typeFilter, setTypeFilter: manageMode.setTypeFilter } : undefined}
    />
  );
  const loading = query.isPending;
  const clipHere = manageActive && clip && clip.targetKey === manager.key ? clip : null;
  const selected = selection.selectionMode ? selectedFiles() : [];
  const filterLabel = manageActive
    ? t(MANAGE_FILTER_LABELS[manageMode.typeFilter])
    : t(FILTER_OPTIONS.find((f) => f.key === filterMode)?.label ?? '');
  const viewerItems = viewerStart ? viewables : [];
  const viewerIndex = viewerStart ? viewables.findIndex((f) => fileKey(f) === viewerStart) : -1;

  const toolButton = (active: boolean) =>
    `p-2 rounded-lg transition-colors ${active ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`;

  const rowCommon = (file: ChannelFile, index: number) => {
    const isAudio = file.category === 'Audio';
    const isFolder = file.category === 'Folder';
    const cached = isAudio && cachedTrackIds.has(file.id);
    return {
      'data-row-index': index,
      tabIndex: 0,
      'aria-selected': selection.selectionMode ? selection.isSelected(file) : undefined,
      'aria-label': t(cached ? '{kind} {name}, on device' : '{kind} {name}', {
        kind: isFolder ? t('Folder') : isAudio ? t('Track') : t('File'),
        name: file.name
      }),
      onClick: (e: React.MouseEvent) => handleRowClick(file, e),
      ...longPress.bind(file),
      draggable: isDesktop && !manageOnly && (isAudio || isFolder),
      onDragStart: (e: React.DragEvent) => {
        longPress.bind(file).onDragStart();
        handleDragStart(file, e);
      }
    };
  };

  const moreButton = (file: ChannelFile, className = '') => (
    <button
      onClick={(e) => {
        stop(e);
        setDetailsFile(file);
      }}
      onMouseDown={stop}
      onTouchStart={stop}
      className={`p-2 text-slate-400 hover:text-emerald-400 transition-colors ${className}`}
      aria-label={t('Details and actions for {name}', { name: file.name })}
      title={t('Details and actions')}
    >
      <MoreVertical className="w-5 h-5" aria-hidden />
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      <Header
        title={title}
        subtitle={subtitle ? subtitle(totalCount) : t('{count} files', { count: totalCount })}
        showBack
        backPath={backPath}
        actions={headerActions}
      />

      <div className="flex-1 min-h-0 flex">
        {sidePanel && (
          <aside className="hidden lg:block w-72 xl:w-80 shrink-0 border-r border-slate-700 overflow-y-auto" aria-label={t('Details and filters')}>
            {sidePanel(filterControls)}
          </aside>
        )}

        <div className="flex-1 min-w-0 flex flex-col">
          {banner}

          {selection.selectionMode && manageActive ? (
            <ManageSelectionBar
              count={selection.selectedCount}
              total={files.length}
              busy={bulkBusy}
              operations={ops}
              hasFiles={selected.some((f) => f.category !== 'Folder')}
              onSelectAll={() => selection.selectAll(files)}
              onDeselectAll={selection.deselectAll}
              onCancel={selection.exitSelection}
              onCut={() => {
                fileOps.toClipboard('cut', selected);
                selection.exitSelection();
              }}
              onCopy={() => {
                fileOps.toClipboard('copy', selected);
                selection.exitSelection();
              }}
              onDelete={() => withBusy(async () => {
                if (!(await fileOps.remove(selected))) throw new Error('cancelled');
              }).catch(() => {})}
              onDownload={() => {
                fileOps.downloadToDevice(selected);
                selection.exitSelection();
              }}
              onDownloadToServer={() => withBusy(() => fileOps.downloadToServer(selected))}
              onPreload={() => withBusy(() => fileOps.preload(selected))}
              onRename={() => selected[0] && setNameDialog({ mode: 'rename', file: selected[0] })}
              onDetails={() => selected[0] && setDetailsFile(selected[0])}
            />
          ) : selection.selectionMode ? (
            <SelectionBar
              count={selection.selectedCount}
              total={files.length}
              busy={bulkBusy}
              busyLabel={bulkLabel}
              onSelectAll={() => selection.selectAll(files)}
              onDeselectAll={selection.deselectAll}
              onAddToPlaylist={() => withSelectedTracks((tracks) => setPickerTracks(tracks))}
              onDownload={handleBulkDownload}
              onPlayNext={handleBulkPlayNext}
              onCancel={selection.exitSelection}
            />
          ) : (
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 border-b border-slate-700 overflow-x-auto no-scrollbar" role="toolbar" aria-label={t('File list')}>
              <button
                onClick={() => setShowSearch(!showSearch)}
                aria-pressed={showSearch}
                aria-label={t('Search files')}
                className={`${toolButton(showSearch)} shrink-0`}
              >
                <Search className="w-5 h-5" aria-hidden />
              </button>

              {/* Desktop with a side panel shows the filters there */}
              <button
                onClick={() => setShowFilters(!showFilters)}
                aria-pressed={showFilters}
                aria-expanded={showFilters}
                aria-label={t('Filters and sorting')}
                className={`${sidePanel ? 'lg:hidden' : ''} ${toolButton(showFilters)} shrink-0`}
              >
                <SlidersHorizontal className="w-5 h-5" aria-hidden />
              </button>

              <button
                onClick={() => files[0] && selection.startWith(files[0])}
                disabled={files.length === 0}
                className="hidden lg:flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-700 text-slate-300 text-sm hover:bg-slate-600 disabled:opacity-50 shrink-0"
                title={t('Select files (or Ctrl+click, or Space on a row)')}
              >
                <ListChecks className="w-4 h-4" aria-hidden />
                {t('Select')}
              </button>

              <span className="hidden min-[420px]:inline px-3 py-1 text-xs bg-slate-700 rounded-full text-slate-300 whitespace-nowrap truncate">
                {filterLabel}
              </span>

              <div className="flex-1" />

              {manageActive && (
                <>
                  <button
                    onClick={() => manageMode.setViewMode(grid ? 'list' : 'grid')}
                    className={`${toolButton(false)} shrink-0`}
                    aria-label={grid ? t('Show as list') : t('Show as grid')}
                    title={grid ? t('Show as list') : t('Show as grid')}
                  >
                    {grid ? <ListIcon className="w-5 h-5" aria-hidden /> : <LayoutGrid className="w-5 h-5" aria-hidden />}
                  </button>
                  <button
                    onClick={() => fileOps.refresh()}
                    className={`${toolButton(false)} shrink-0 hidden sm:block`}
                    aria-label={t('Reload the list')}
                    title={t('Reload the list')}
                  >
                    <RefreshCw className={`w-5 h-5 ${query.isFetching && !isFetchingNextPage ? 'animate-spin' : ''}`} aria-hidden />
                  </button>
                  {ops.has('createFolder') && (
                    <button
                      onClick={() => setNameDialog({ mode: 'create' })}
                      className={`${toolButton(false)} shrink-0`}
                      aria-label={t('New folder')}
                      title={t('New folder')}
                    >
                      <FolderPlus className="w-5 h-5" aria-hidden />
                    </button>
                  )}
                  {canUpload && (
                    <>
                      <button
                        onClick={() => uploadInputRef.current?.click()}
                        className={`${toolButton(false)} shrink-0`}
                        aria-label={t('Upload files from this device')}
                        title={t('Upload files from this device')}
                      >
                        <Upload className="w-5 h-5" aria-hidden />
                      </button>
                      <input ref={uploadInputRef} type="file" multiple hidden onChange={onUploadPicked} aria-hidden tabIndex={-1} />
                    </>
                  )}
                </>
              )}

              {manager && !manageOnly && (
                <button
                  onClick={() => setManage(!manageActive)}
                  aria-pressed={manageActive}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm whitespace-nowrap shrink-0 transition-colors ${
                    manageActive ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
                  }`}
                  title={manageActive ? t('Back to the music view') : t('Manage files: every file type, folders, upload, move...')}
                >
                  <FolderCog className="w-4 h-4" aria-hidden />
                  <span className="hidden sm:inline">{t('Manage')}</span>
                  <span className="sr-only sm:hidden">{t('Manage')}</span>
                </button>
              )}

              {!manageActive && (
                <button
                  onClick={() => startQueue()}
                  className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium whitespace-nowrap shrink-0"
                >
                  <Play className="w-4 h-4" fill="currentColor" aria-hidden />
                  {t('Play All')}
                </button>
              )}
            </div>
          )}

          {showSearch && !selection.selectionMode && (
            <div className="flex items-center gap-2 px-4 py-2 bg-slate-800 border-b border-slate-700">
              <Search className="w-5 h-5 text-slate-400" aria-hidden />
              <input
                type="search"
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder={t('Search files...')}
                aria-label={t('Search files in this folder')}
                className="flex-1 bg-transparent text-white placeholder-slate-400 outline-none"
                autoFocus
              />
              {searchText && (
                <button onClick={() => setSearchText('')} className="p-1 text-slate-400" aria-label={t('Clear search')}>
                  <X className="w-4 h-4" aria-hidden />
                </button>
              )}
            </div>
          )}

          {showFilters && !selection.selectionMode && (
            <div className={`${sidePanel ? 'lg:hidden' : ''} px-4 py-3 bg-slate-800 border-b border-slate-700`}>
              {filterControls}
            </div>
          )}

          {clipHere && !selection.selectionMode && (
            <PasteBar
              clip={clipHere}
              canPasteHere={canPaste(clipHere, manager!.key, source.location)}
              onPasteHere={() => pasteInto({ location: source.location, path: manager!.kind === 'local' ? source.location : currentPath, name: breadcrumbs[breadcrumbs.length - 1] ?? '' })}
              onChooseFolder={() => setFolderPicker(true)}
              onClear={fileOps.clearClipboard}
            />
          )}

          {breadcrumbs.length > 0 && (
            <nav aria-label={t('Folder path')} className="flex items-center gap-2 px-4 py-2 text-sm overflow-x-auto no-scrollbar bg-slate-800/50">
              <button onClick={() => onNavigateBreadcrumb(-1)} className="text-emerald-400 hover:underline whitespace-nowrap">
                {t('Root')}
              </button>
              {breadcrumbs.map((name, index) => {
                const isLast = index === breadcrumbs.length - 1;
                return (
                  <div key={`${index}-${name}`} className="flex items-center gap-2">
                    <ChevronRight className="w-4 h-4 text-slate-500 flex-shrink-0" aria-hidden />
                    <button
                      onClick={() => onNavigateBreadcrumb(index)}
                      aria-current={isLast ? 'location' : undefined}
                      className={`whitespace-nowrap ${isLast ? 'text-white' : 'text-emerald-400 hover:underline'}`}
                    >
                      {name}
                    </button>
                  </div>
                );
              })}
            </nav>
          )}

          {!loading && files.length > 0 && !grid && (
            <div className="hidden lg:flex items-center gap-4 px-4 py-2 text-xs uppercase tracking-wide text-slate-500 border-b border-slate-700" aria-hidden>
              {selection.selectionMode && <span className="w-5 shrink-0" />}
              <span className="w-10 shrink-0" />
              <span className="flex-1">{t('Name')}</span>
              <span className="w-16 shrink-0">{t('Type')}</span>
              <span className="w-20 shrink-0 text-right">{t('Size')}</span>
              <span className="hidden xl:block w-28 shrink-0">{t('Date')}</span>
              <span className="w-[7.5rem] shrink-0" />
            </div>
          )}

          <div
            ref={listRef}
            onScroll={handleListScroll}
            className={`flex-1 overflow-y-auto relative ${dropActive ? 'ring-2 ring-inset ring-emerald-400 bg-emerald-500/5' : ''}`}
            {...dropHandlers}
          >
            {dropActive && (
              <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
                <span className="px-4 py-2 rounded-full bg-emerald-500 text-white text-sm shadow-lg">{t('Drop to upload here')}</span>
              </div>
            )}
            {loading ? (
              <LoadingScreen message={t('Loading files...')} />
            ) : files.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Folder className="w-12 h-12 mb-4 opacity-50" aria-hidden />
                <p>{t('No files found')}</p>
                <p className="text-sm mt-2">{manageActive ? t('This folder is empty or nothing matches the filter') : emptyHint}</p>
              </div>
            ) : (
              <>
                {grid ? (
                  <FileGrid
                    files={files}
                    totalCount={totalCount}
                    scrollRef={listRef}
                    onNearEnd={loadMoreForGrid}
                    onTileKey={handleRowKeyDown}
                    renderTile={(file, index, onKeyDown) => {
                      const isSelected = selection.isSelected(file);
                      const isFolder = file.category === 'Folder';
                      return (
                        <div
                          key={fileKey(file)}
                          role="gridcell"
                          {...rowCommon(file, index)}
                          onKeyDown={onKeyDown}
                          className={`group relative flex flex-col rounded-xl overflow-hidden cursor-pointer select-none outline-none touch-manipulation focus-visible:ring-2 focus-visible:ring-emerald-400 ${
                            isSelected ? 'bg-emerald-500/20 ring-2 ring-emerald-500' : 'bg-slate-800 hover:bg-slate-700/70'
                          }`}
                        >
                          <FileThumb
                            file={file}
                            thumbnailUrl={manager?.thumbnailUrl(file)}
                            className="w-full aspect-square [&>svg]:w-10 [&>svg]:h-10"
                            rounded="rounded-none"
                          />
                          <div className="px-2 py-1.5 min-w-0 h-[52px]">
                            <p className="text-xs text-white line-clamp-2 break-words leading-tight" title={file.name}>{file.name}</p>
                            <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                              {isFolder ? t('Folder') : file.sizeText ?? formatFileSize(file.size)}
                            </p>
                          </div>
                          {selection.selectionMode ? (
                            <div className="absolute top-1.5 left-1.5 rounded-full bg-black/50 text-emerald-400" aria-hidden>
                              {isSelected ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5 text-white/80" />}
                            </div>
                          ) : (
                            moreButton(file, 'absolute top-1 right-1 bg-black/40 rounded-full !p-1.5 !text-white lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 focus-visible:opacity-100')
                          )}
                        </div>
                      );
                    }}
                  />
                ) : (
                  <div
                    role="list"
                    aria-label={t('{count} of {total} files', { count: files.length, total: totalCount })}
                    className="relative w-full"
                    style={{ height: virtualizer.getTotalSize() }}
                  >
                    {virtualItems.map((virtualRow) => {
                      const file = files[virtualRow.index];
                      const isSelected = selection.isSelected(file);
                      const isAudio = file.category === 'Audio';
                      const isFolder = file.category === 'Folder';
                      const cached = isAudio && cachedTrackIds.has(file.id);
                      const fileDate = file.dateModified || file.dateCreated;
                      return (
                        <div
                          key={fileKey(file)}
                          data-index={virtualRow.index}
                          ref={virtualizer.measureElement}
                          role="listitem"
                          {...rowCommon(file, virtualRow.index)}
                          onKeyDown={(e) => handleRowKeyDown(file, virtualRow.index, e)}
                          className={`group absolute left-0 top-0 w-full flex items-center gap-3 lg:gap-4 px-4 py-3 lg:py-2.5 border-b border-slate-700 transition-colors touch-manipulation text-left cursor-pointer select-none outline-none focus-visible:bg-slate-800 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 ${
                            isSelected ? 'bg-emerald-500/15' : 'hover:bg-slate-800'
                          }`}
                          style={{ transform: `translateY(${virtualRow.start}px)` }}
                        >
                          {selection.selectionMode && (
                            <div className="flex-shrink-0 text-emerald-400" aria-hidden>
                              {isSelected ? <CheckCircle2 className="w-5 h-5" /> : <Circle className="w-5 h-5 text-slate-500" />}
                            </div>
                          )}
                          {manageActive ? (
                            <div className="relative">
                              <FileThumb file={file} thumbnailUrl={manager.thumbnailUrl(file)} />
                              {cached && <CachedBadge />}
                            </div>
                          ) : (
                            <div
                              className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 relative ${
                                isFolder ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'
                              }`}
                            >
                              {categoryIcons[file.category] || <Music className="w-5 h-5" aria-hidden />}
                              {cached && <CachedBadge />}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-white truncate" title={file.name}>{file.name}</p>
                            <p className="text-xs text-slate-400 lg:hidden truncate">
                              {!isFolder && (file.sizeText ?? formatFileSize(file.size))}
                              {manageActive && !isFolder && fileDate ? ` · ${formatDate(fileDate)}` : ''}
                            </p>
                          </div>

                          <span className="hidden lg:block w-16 shrink-0 text-xs text-slate-400 truncate">{fileExtension(file)}</span>
                          <span className="hidden lg:block w-20 shrink-0 text-xs text-slate-400 text-right tabular-nums">
                            {!isFolder ? file.sizeText ?? formatFileSize(file.size) : ''}
                          </span>
                          <span className="hidden xl:block w-28 shrink-0 text-xs text-slate-400 tabular-nums">
                            {fileDate ? formatDate(fileDate) : ''}
                          </span>

                          <div className="flex items-center justify-end lg:w-[7.5rem] shrink-0">
                            {isAudio && !selection.selectionMode && !manageOnly && !manageActive && (
                              <>
                                <button
                                  onClick={(e) => {
                                    stop(e);
                                    playNext(source.toTrack(file));
                                    addToast(t('Will play next'), 'success');
                                  }}
                                  onMouseDown={stop}
                                  onTouchStart={stop}
                                  className="hidden lg:block p-2 text-slate-500 hover:text-emerald-400 transition-colors lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 focus-visible:opacity-100"
                                  aria-label={t('Play {name} next', { name: file.name })}
                                  title={t('Play next')}
                                >
                                  <ListPlus className="w-5 h-5" aria-hidden />
                                </button>
                                {!cached && (
                                  activeDownloads.has(file.id) ? (
                                    <span className="p-2 text-amber-400 text-xs tabular-nums" aria-label={t('Downloading {percent}%', { percent: activeDownloads.get(file.id) ?? 0 })}>
                                      {activeDownloads.get(file.id)}%
                                    </span>
                                  ) : (
                                    <button
                                      onClick={async (e) => {
                                        stop(e);
                                        await downloadManager.addToQueue(source.toTrack(file));
                                        addToast(t('Added to download queue'), 'info');
                                      }}
                                      onMouseDown={stop}
                                      onTouchStart={stop}
                                      className="p-2 text-slate-500 hover:text-emerald-400 transition-colors"
                                      aria-label={t('Download {name}', { name: file.name })}
                                      title={t('Download')}
                                    >
                                      <Download className="w-5 h-5" aria-hidden />
                                    </button>
                                  )
                                )}
                                <button
                                  onClick={(e) => {
                                    stop(e);
                                    setPickerTracks([source.toTrack(file)]);
                                  }}
                                  onMouseDown={stop}
                                  onTouchStart={stop}
                                  className="p-2 text-slate-500 hover:text-emerald-400 transition-colors"
                                  aria-label={t('Add {name} to a playlist', { name: file.name })}
                                  title={t('Add to playlist')}
                                >
                                  <Plus className="w-5 h-5" aria-hidden />
                                </button>
                              </>
                            )}
                            {manageActive && !selection.selectionMode && moreButton(file)}
                            {isFolder && !selection.selectionMode && !manageActive && (
                              <ChevronRight className="w-5 h-5 text-slate-500" aria-hidden />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {isFetchingNextPage && (
                  <div className="flex items-center justify-center py-4 gap-2 text-slate-400" role="status">
                    <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
                    <span className="text-sm">{t('Loading more...')}</span>
                  </div>
                )}

                <div className="py-3 text-center text-xs text-slate-500">
                  {t('{count} of {total} files', { count: files.length, total: totalCount })}
                  {isDesktop && !manageActive && <span className="ml-2">· {t('drag tracks or folders onto a playlist in the sidebar')}</span>}
                  {isDesktop && canUpload && <span className="ml-2">· {t('drop files here to upload them')}</span>}
                </div>
              </>
            )}
          </div>

          {manageActive && <UploadPanel />}
        </div>
      </div>

      {pickerTracks && (
        <PlaylistPicker
          tracks={pickerTracks}
          onClose={() => setPickerTracks(null)}
          onAdded={selection.exitSelection}
        />
      )}

      {manageActive && detailsFile && (
        <FileDetailsSheet
          file={detailsFile}
          kind={manager.kind}
          thumbnailUrl={manager.thumbnailUrl(detailsFile)}
          actions={entryActions(detailsFile)}
          onClose={() => setDetailsFile(null)}
        />
      )}

      {manageActive && viewerIndex >= 0 && (
        <MediaViewer
          items={viewerItems}
          startIndex={viewerIndex}
          target={manager}
          canDownload={ops.has('downloadToDevice')}
          onDetails={(file) => setDetailsFile(file)}
          onClose={() => setViewerStart(null)}
        />
      )}

      {manageActive && nameDialog && (
        <NameDialog
          title={nameDialog.mode === 'create' ? t('New folder') : t('Rename "{name}"', { name: nameDialog.file.name })}
          initialName={nameDialog.mode === 'rename' ? nameDialog.file.name : ''}
          confirmLabel={nameDialog.mode === 'create' ? t('Create') : t('Rename')}
          onSubmit={async (name) => {
            if (nameDialog.mode === 'create') await fileOps.createFolder(name);
            else {
              await fileOps.rename(nameDialog.file, name);
              selection.exitSelection();
            }
          }}
          onClose={() => setNameDialog(null)}
        />
      )}

      {manageActive && folderPicker && clipHere && (
        <FolderPickerDialog
          target={manager}
          title={clipHere.mode === 'cut' ? t('Move to...') : t('Copy to...')}
          confirmLabel={clipHere.mode === 'cut' ? t('Move here') : t('Copy here')}
          disabledLocations={new Set(clipHere.files.filter((f) => f.category === 'Folder').map((f) => (manager.kind === 'local' ? f.path : f.id)))}
          onPick={(folder) => {
            setFolderPicker(false);
            pasteInto(folder);
          }}
          onClose={() => setFolderPicker(false)}
        />
      )}
    </div>
  );
}

const NO_OPS: ReadonlySet<ManageOperation> = new Set();

function CachedBadge() {
  return (
    <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center" aria-hidden>
      <Check className="w-2.5 h-2.5 text-white" />
    </div>
  );
}
