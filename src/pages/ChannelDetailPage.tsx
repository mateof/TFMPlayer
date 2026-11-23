import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { FileBrowser, FILE_PAGE_SIZE, type FileSource, type QueueStartContext } from '@/components/files/FileBrowser';
import { RefreshChannelDialog } from '@/components/channels/RefreshChannelDialog';
import { ChannelInfoPanel } from '@/components/channels/ChannelInfoPanel';
import { channelsApi } from '@/services/api/channels.api';
import { channelRefreshService, useChannelRefreshStore } from '@/services/channelRefresh/ChannelRefreshService';
import { useChannelInfoQuery, useChannelStatsQuery } from '@/hooks/queries';
import { usePlayerStore } from '@/stores/playerStore';
import { queryKeys } from '@/services/query/queryClient';
import { fileToTrack } from '@/utils/channelTracks';
import { collectChannelFolderTracks } from '@/utils/collectTracks';
import { t } from '@/i18n';

interface FolderBreadcrumb {
  id: string;
  name: string;
}

function parseBreadcrumbs(raw: string | null): FolderBreadcrumb[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function ChannelDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [showRefreshDialog, setShowRefreshDialog] = useState(false);

  const infoQuery = useChannelInfoQuery(id);
  const statsQuery = useChannelStatsQuery(id);
  const channel = infoQuery.data ?? null;
  const stats = statsQuery.data ?? null;
  const channelName = channel?.name ?? stats?.name ?? '';
  const refreshJob = useChannelRefreshStore((s) => (id ? s.jobs[id] : undefined));

  const currentFolderId = searchParams.get('folder') || '';
  const pathParam = searchParams.get('path');
  const folderPath = useMemo(() => parseBreadcrumbs(pathParam), [pathParam]);

  // A scan started elsewhere (web UI, another device): follow it too
  useEffect(() => {
    if (id && stats?.isRefreshing) channelRefreshService.track(id, channelName || stats.name);
  }, [id, stats?.isRefreshing, stats?.name, channelName]);

  // When a refresh of this channel finishes, reload what it may have added
  const refreshPhase = refreshJob?.phase;
  const prevPhaseRef = useRef(refreshPhase);
  useEffect(() => {
    const prev = prevPhaseRef.current;
    prevPhaseRef.current = refreshPhase;
    if (id && prev === 'running' && refreshPhase && refreshPhase !== 'running') {
      queryClient.invalidateQueries({ queryKey: ['files', `channel:${id}`] });
      queryClient.invalidateQueries({ queryKey: queryKeys.channels.stats(id) });
      queryClient.invalidateQueries({ queryKey: queryKeys.channels.info(id) });
    }
  }, [refreshPhase, id, queryClient]);

  const source = useMemo<FileSource>(() => ({
    key: `channel:${id}`,
    location: currentFolderId,
    fetchPage: (page, params) =>
      channelsApi.getFiles(parseInt(id!), currentFolderId || undefined, { page, ...params }),
    toTrack: (file) => fileToTrack(file, id!, channelName),
    collectFolder: (file, onProgress) => collectChannelFolderTracks(id!, channelName, file.id, onProgress),
    folderDragItem: (file) => ({
      kind: 'channel-folder',
      channelId: id!,
      channelName,
      folderId: file.id,
      name: file.name
    })
  }), [id, currentFolderId, channelName]);

  const openFolder = (folder: FolderBreadcrumb) => {
    const params = new URLSearchParams(searchParams);
    params.set('folder', folder.id);
    params.set('path', encodeURIComponent(JSON.stringify([...folderPath, folder])));
    setSearchParams(params);
  };

  const navigateBreadcrumb = (index: number) => {
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
  const registerQueueSource = ({ filters, nextPage, hasMore }: QueueStartContext) => {
    usePlayerStore.getState().setQueueSource({
      type: 'channel',
      channelId: id!,
      channelName,
      folderId: currentFolderId || undefined,
      filterMode: filters.filterMode,
      search: filters.debouncedSearch || undefined,
      sortBy: filters.sortBy,
      sortDesc: filters.sortDesc,
      nextPage,
      pageSize: FILE_PAGE_SIZE,
      hasMore
    });
  };

  const refreshRunning = refreshJob?.phase === 'running' || (!refreshJob && !!stats?.isRefreshing);

  return (
    <>
      <FileBrowser
        source={source}
        title={channelName || t('Channel')}
        subtitle={(total) => t('{count} files', { count: total }) + (stats ? ` · ${t('{size} indexed', { size: stats.totalSizeText })}` : '')}
        backPath="/channels"
        breadcrumbs={folderPath.map((f) => f.name)}
        onNavigateBreadcrumb={navigateBreadcrumb}
        onOpenFolder={(file) => openFolder({ id: file.id, name: file.name })}
        onQueueStarted={registerQueueSource}
        emptyHint={t('Try changing the filter or refreshing the channel')}
        headerActions={
          <button
            onClick={() => setShowRefreshDialog(true)}
            disabled={refreshRunning || !channelName}
            className="p-2 text-slate-400 hover:text-white transition-colors disabled:opacity-60"
            aria-label={refreshRunning ? t('Refreshing channel') : t('Refresh channel from Telegram')}
            title={refreshRunning ? t('Refreshing channel...') : t('Refresh channel from Telegram')}
          >
            <RefreshCw className={`w-5 h-5 ${refreshRunning ? 'animate-spin text-emerald-400' : ''}`} aria-hidden />
          </button>
        }
        banner={
          refreshRunning ? (
            <div role="status" className="lg:hidden flex items-center gap-2 px-4 py-2 text-xs text-emerald-300 bg-emerald-500/10 border-b border-slate-700">
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
              {t('Refreshing channel on the server. The list reloads when it finishes.')}
            </div>
          ) : undefined
        }
        sidePanel={(filterControls) => (
          <ChannelInfoPanel
            channelId={id!}
            channel={channel}
            stats={stats}
            job={refreshJob}
            onRefresh={() => setShowRefreshDialog(true)}
          >
            {filterControls}
          </ChannelInfoPanel>
        )}
      />

      {showRefreshDialog && channelName && (
        <RefreshChannelDialog
          channelId={id!}
          channelName={channelName}
          stats={stats}
          onClose={() => setShowRefreshDialog(false)}
        />
      )}
    </>
  );
}
