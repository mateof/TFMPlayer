import { useState, useEffect, useCallback } from 'react';
import { Download, Music, Trash2, HardDrive, X, RotateCcw, Play } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/common/Button';
import { LoadingScreen } from '@/components/common/Spinner';
import { db } from '@/db/database';
import { formatFileSize, formatRelativeTime } from '@/utils/format';
import { downloadManager, useDownloadStore } from '@/services/download/DownloadManager';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import type { CachedTrackEntity, DownloadQueueEntity } from '@/db/database';

type Tab = 'queue' | 'cached';

export function DownloadsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('cached');
  const [loading, setLoading] = useState(true);
  const [downloads, setDownloads] = useState<DownloadQueueEntity[]>([]);
  const [failedDownloads, setFailedDownloads] = useState<DownloadQueueEntity[]>([]);
  const [cachedTracks, setCachedTracks] = useState<CachedTrackEntity[]>([]);
  const [totalCacheSize, setTotalCacheSize] = useState(0);

  const activeDownloads = useDownloadStore((state) => state.activeDownloads);
  const isProcessing = useDownloadStore((state) => state.isProcessing);
  const { play } = useAudioPlayer();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [allQueue, cached] = await Promise.all([
        db.downloadQueue.toArray(), // Get ALL queue items for debugging
        db.cachedTracks.toArray()
      ]);

      // Separate by status
      const pending = allQueue.filter(d => d.status === 'pending' || d.status === 'downloading');
      const failed = allQueue.filter(d => d.status === 'failed');

      console.log('Download queue status:', {
        total: allQueue.length,
        pending: pending.length,
        failed: failed.length,
        completed: allQueue.filter(d => d.status === 'completed').length,
        cancelled: allQueue.filter(d => d.status === 'cancelled').length
      });

      setDownloads(pending);
      setFailedDownloads(failed);
      setCachedTracks(cached);
      setTotalCacheSize(cached.reduce((acc, t) => acc + t.fileSize, 0));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Refresh data when download state changes
  useEffect(() => {
    const interval = setInterval(() => {
      if (isProcessing || activeDownloads.size > 0) {
        loadData();
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [isProcessing, activeDownloads.size, loadData]);

  const handleDeleteCachedTrack = async (track: CachedTrackEntity) => {
    if (!confirm(`Remove "${track.fileName}" from cache?`)) return;

    try {
      await db.cachedTracks.delete(track.id);
      loadData();
    } catch (error) {
      console.error('Failed to delete cached track:', error);
    }
  };

  const handleClearCache = async () => {
    if (!confirm('Clear all cached tracks?')) return;

    try {
      await db.cachedTracks.clear();
      loadData();
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  };

  const handleCancelDownload = async (trackId: string) => {
    await downloadManager.cancelDownload(trackId);
    loadData();
  };

  const handleCancelAllDownloads = async () => {
    if (!confirm('Cancel all downloads?')) return;
    await downloadManager.cancelAll();
    loadData();
  };

  const handleRetryDownload = async (trackId: string) => {
    await downloadManager.retryDownload(trackId);
    loadData();
  };

  const handlePlayCachedTrack = (track: CachedTrackEntity) => {
    // Convert all cached tracks to Track format for the queue
    const allTracks = cachedTracks.map(t => ({
      fileId: t.id,
      messageId: 0,
      channelId: t.channelId || '',
      channelName: t.channelName || '',
      fileName: t.fileName,
      filePath: '',
      fileType: 'Audio' as const,
      fileSize: t.fileSize,
      order: 0,
      dateAdded: t.cachedAt.toISOString(),
      isLocalFile: true,
      streamUrl: t.streamUrl || '',
      title: t.title || t.fileName.replace(/\.[^/.]+$/, ''),
      artist: t.artist,
      album: t.album,
      duration: t.duration
    }));

    // Find the index of the selected track
    const startIndex = cachedTracks.findIndex(t => t.id === track.id);

    // Play the selected track with all cached tracks as the queue
    play(allTracks[startIndex >= 0 ? startIndex : 0], allTracks, startIndex >= 0 ? startIndex : 0);
  };

  const handleClearFailed = async () => {
    if (!confirm('Clear all failed downloads?')) return;
    await db.downloadQueue.where('status').equals('failed').delete();
    loadData();
  };

  const handleClearAllQueue = async () => {
    if (!confirm('Clear entire download queue? This will remove all pending, failed, and completed items.')) return;
    await downloadManager.clearQueue();
    loadData();
  };

  const handleRestartQueue = async () => {
    await downloadManager.restartQueue();
    loadData();
  };

  const queueCount = downloads.length + failedDownloads.length;
  const tabs: { key: Tab; label: string }[] = [
    { key: 'queue', label: `Queue (${queueCount})` },
    { key: 'cached', label: `Cached (${cachedTracks.length})` }
  ];

  return (
    <div className="flex flex-col min-h-screen">
      <Header title="Downloads" />

      {/* Cache size info */}
      <div className="px-4 py-3 bg-slate-800 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardDrive className="w-5 h-5 text-slate-400" />
          <div>
            <p className="text-sm text-white">Cache Size</p>
            <p className="text-xs text-slate-400">{formatFileSize(totalCacheSize)}</p>
          </div>
        </div>
        {cachedTracks.length > 0 && (
          <Button variant="ghost" size="sm" onClick={handleClearCache}>
            Clear All
          </Button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-3 text-sm font-medium transition-colors ${
              activeTab === tab.key
                ? 'text-emerald-400 border-b-2 border-emerald-400'
                : 'text-slate-400'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingScreen message="Loading..." />
        ) : activeTab === 'queue' ? (
          <DownloadQueue
            downloads={downloads}
            failedDownloads={failedDownloads}
            activeDownloads={activeDownloads}
            onCancel={handleCancelDownload}
            onCancelAll={handleCancelAllDownloads}
            onRetry={handleRetryDownload}
            onClearFailed={handleClearFailed}
            onClearAllQueue={handleClearAllQueue}
            onRestartQueue={handleRestartQueue}
          />
        ) : (
          <CachedTracksList
            tracks={cachedTracks}
            onDelete={handleDeleteCachedTrack}
            onPlay={handlePlayCachedTrack}
          />
        )}
      </div>
    </div>
  );
}

interface DownloadQueueProps {
  downloads: DownloadQueueEntity[];
  failedDownloads: DownloadQueueEntity[];
  activeDownloads: Map<string, number>;
  onCancel: (trackId: string) => void;
  onCancelAll: () => void;
  onRetry: (trackId: string) => void;
  onClearFailed: () => void;
  onClearAllQueue: () => void;
  onRestartQueue: () => void;
}

function DownloadQueue({
  downloads,
  failedDownloads,
  activeDownloads,
  onCancel,
  onCancelAll,
  onRetry,
  onClearFailed,
  onClearAllQueue,
  onRestartQueue
}: DownloadQueueProps) {
  if (downloads.length === 0 && failedDownloads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <Download className="w-12 h-12 mb-4 opacity-50" />
        <p>No active downloads</p>
        <div className="flex gap-2 mt-4">
          <Button variant="ghost" size="sm" onClick={onClearAllQueue}>
            Clear Queue
          </Button>
          <Button variant="primary" size="sm" onClick={onRestartQueue}>
            Restart Queue
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {/* Action buttons */}
      <div className="p-4 border-b border-slate-700 flex gap-2 flex-wrap">
        {downloads.length > 0 && (
          <Button variant="ghost" size="sm" onClick={onCancelAll}>
            Cancel All ({downloads.length})
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={onClearAllQueue}>
          Clear Queue
        </Button>
        <Button variant="primary" size="sm" onClick={onRestartQueue}>
          Restart Queue
        </Button>
      </div>

      {/* Active/Pending downloads */}
      <div className="divide-y divide-slate-700">
        {downloads.map((download) => {
          const progress = activeDownloads.get(download.trackId) ?? download.progress;
          return (
            <div key={download.id} className="p-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 bg-slate-700 rounded-lg flex items-center justify-center">
                  <Music className="w-5 h-5 text-slate-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{download.fileName}</p>
                  <p className="text-xs text-slate-400">{download.channelName}</p>
                </div>
                <span className="text-xs text-emerald-400 tabular-nums">
                  {progress}%
                </span>
                <button
                  onClick={() => onCancel(download.trackId)}
                  className="p-2 text-slate-500 hover:text-red-400 transition-colors"
                  title="Cancel"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              {/* Progress bar */}
              <div className="mt-2 h-1 bg-slate-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Failed downloads */}
      {failedDownloads.length > 0 && (
        <>
          <div className="p-4 border-b border-slate-700 flex items-center justify-between">
            <p className="text-sm text-red-400">Failed ({failedDownloads.length})</p>
            <Button variant="ghost" size="sm" onClick={onClearFailed}>
              Clear Failed
            </Button>
          </div>
          <div className="divide-y divide-slate-700">
            {failedDownloads.map((download) => (
              <div key={download.id} className="p-4 bg-red-500/5">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 bg-red-500/20 rounded-lg flex items-center justify-center">
                    <Music className="w-5 h-5 text-red-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{download.fileName}</p>
                    <p className="text-xs text-red-400 truncate">
                      {download.errorMessage || 'Download failed'}
                    </p>
                  </div>
                  <button
                    onClick={() => onRetry(download.trackId)}
                    className="p-2 text-slate-500 hover:text-emerald-400 transition-colors"
                    title="Retry"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

interface CachedTracksListProps {
  tracks: CachedTrackEntity[];
  onDelete: (track: CachedTrackEntity) => void;
  onPlay: (track: CachedTrackEntity) => void;
}

function CachedTracksList({ tracks, onDelete, onPlay }: CachedTracksListProps) {
  if (tracks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <Music className="w-12 h-12 mb-4 opacity-50" />
        <p>No cached tracks</p>
        <p className="text-sm mt-2">Download tracks for offline listening</p>
      </div>
    );
  }

  return (
    <div className="divide-y divide-slate-700">
      {tracks.map((track) => (
        <button
          key={track.id}
          onClick={() => onPlay(track)}
          className="w-full flex items-center gap-4 p-4 hover:bg-slate-800 transition-colors text-left"
        >
          <div className="w-10 h-10 bg-emerald-500/20 rounded-lg flex items-center justify-center">
            <Music className="w-5 h-5 text-emerald-400" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">
              {track.title || track.fileName}
            </p>
            <p className="text-xs text-slate-400">
              {track.channelName} • {formatFileSize(track.fileSize)} • {formatRelativeTime(track.cachedAt)}
            </p>
          </div>
          <div
            onClick={(e) => {
              e.stopPropagation();
              onPlay(track);
            }}
            className="p-2 text-slate-500 hover:text-emerald-400 transition-colors touch-manipulation"
          >
            <Play className="w-5 h-5" />
          </div>
          <div
            onClick={(e) => {
              e.stopPropagation();
              onDelete(track);
            }}
            className="p-2 text-slate-500 hover:text-red-400 transition-colors touch-manipulation"
          >
            <Trash2 className="w-5 h-5" />
          </div>
        </button>
      ))}
    </div>
  );
}
