import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, Music, Trash2, HardDrive, X, RotateCcw, Play, Loader2, Search } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/common/Button';
import { LoadingScreen } from '@/components/common/Spinner';
import { TrackContextMenu } from '@/components/common/TrackContextMenu';
import { db } from '@/db/database';
import { formatFileSize } from '@/utils/format';
import { downloadManager, useDownloadStore } from '@/services/download/DownloadManager';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useUiStore } from '@/stores/uiStore';
import { useSettingsStore } from '@/stores/settingsStore';
import type { CachedTrackEntity, DownloadQueueEntity } from '@/db/database';
import type { Track } from '@/types/models';

type Tab = 'queue' | 'cached';

export function DownloadsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('cached');
  const [loading, setLoading] = useState(true);
  const [downloads, setDownloads] = useState<DownloadQueueEntity[]>([]);
  const [failedDownloads, setFailedDownloads] = useState<DownloadQueueEntity[]>([]);
  const [cachedTracks, setCachedTracks] = useState<CachedTrackEntity[]>([]);
  const [totalCacheSize, setTotalCacheSize] = useState(0);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisProgress, setAnalysisProgress] = useState({ current: 0, total: 0 });
  const [pendingAnalysis, setPendingAnalysis] = useState(0);
  const analysisRunRef = useRef(false);

  const activeDownloads = useDownloadStore((state) => state.activeDownloads);
  const isProcessing = useDownloadStore((state) => state.isProcessing);
  const { play, playNext } = useAudioPlayer();
  const { addToast } = useUiStore();
  const { downloadFormat, downloadBitrate } = useSettingsStore();
  const [contextMenuTrack, setContextMenuTrack] = useState<Track | null>(null);

  // Cached tracks whose stored audio isn't in the configured offline format.
  // Only counted once analysis has recorded what each file actually is.
  const mismatchedTracks = downloadFormat === 'original'
    ? []
    : cachedTracks.filter(
        t => t.audioFormat && t.audioFormat.toLowerCase() !== downloadFormat
      );

  const handleConvertMismatched = async () => {
    if (mismatchedTracks.length === 0) return;
    if (!confirm(
      `Re-download ${mismatchedTracks.length} track(s) in ${downloadFormat.toUpperCase()} ${downloadBitrate}k?\n\n` +
      'The current copies stay available until each new one arrives.'
    )) return;

    const tracks: Track[] = mismatchedTracks.map(t => ({
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
      isLocalFile: (t.streamUrl || '').includes('/stream/local'),
      streamUrl: t.streamUrl || '',
      title: t.title,
      artist: t.artist,
      album: t.album,
      duration: t.duration
    }));

    await downloadManager.addMultipleToQueue(tracks, true);
    addToast(`${tracks.length} track(s) queued for re-download`, 'success');
    setActiveTab('queue');
  };

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

  // Check for tracks pending analysis
  const checkPendingAnalysis = useCallback(async () => {
    const count = await downloadManager.getPendingAnalysisCount();
    setPendingAnalysis(count);
    return count;
  }, []);

  // Auto-analyze tracks that don't have metadata
  const analyzeExistingTracks = useCallback(async () => {
    if (analysisRunRef.current) return;
    analysisRunRef.current = true;
    setIsAnalyzing(true);

    try {
      await downloadManager.analyzeExistingTracks((current, total) => {
        setAnalysisProgress({ current, total });
      });
      await loadData();
    } finally {
      setIsAnalyzing(false);
      analysisRunRef.current = false;
      setPendingAnalysis(0);
    }
  }, [loadData]);

  // Check for pending analysis on mount and auto-analyze
  useEffect(() => {
    const initAnalysis = async () => {
      const count = await checkPendingAnalysis();
      if (count > 0 && !analysisRunRef.current) {
        analyzeExistingTracks();
      }
    };
    initAnalysis();
  }, [checkPendingAnalysis, analyzeExistingTracks]);

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

  const cachedTrackToTrack = (track: CachedTrackEntity): Track => ({
    fileId: track.id,
    messageId: 0,
    channelId: track.channelId || '',
    channelName: track.channelName || '',
    fileName: track.fileName,
    filePath: '',
    fileType: 'Audio' as const,
    fileSize: track.fileSize,
    order: 0,
    dateAdded: track.cachedAt.toISOString(),
    isLocalFile: true,
    streamUrl: track.streamUrl || '',
    title: track.title || track.fileName.replace(/\.[^/.]+$/, ''),
    artist: track.artist,
    album: track.album,
    duration: track.duration
  });

  const handlePlayNext = (track: Track) => {
    playNext(track);
    addToast(`"${track.title || track.fileName}" will play next`, 'info');
  };

  const handleShowContextMenu = (track: CachedTrackEntity) => {
    setContextMenuTrack(cachedTrackToTrack(track));
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
        <div className="flex items-center gap-2">
          {pendingAnalysis > 0 && !isAnalyzing && (
            <Button variant="ghost" size="sm" onClick={analyzeExistingTracks}>
              <Search className="w-4 h-4 mr-1" />
              Analyze ({pendingAnalysis})
            </Button>
          )}
          {cachedTracks.length > 0 && (
            <Button variant="ghost" size="sm" onClick={handleClearCache}>
              Clear All
            </Button>
          )}
        </div>
      </div>

      {/* Offer to re-fetch anything not in the configured offline format */}
      {mismatchedTracks.length > 0 && !isAnalyzing && (
        <div className="px-4 py-2 bg-amber-500/10 border-b border-amber-500/20 flex items-center gap-3">
          <p className="text-sm text-amber-300 flex-1">
            {mismatchedTracks.length} track(s) are not in {downloadFormat.toUpperCase()}
          </p>
          <Button variant="ghost" size="sm" onClick={handleConvertMismatched}>
            Re-download
          </Button>
        </div>
      )}

      {/* Analysis progress */}
      {isAnalyzing && (
        <div className="px-4 py-2 bg-emerald-500/10 border-b border-emerald-500/20 flex items-center gap-3">
          <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
          <p className="text-sm text-emerald-400">
            Analyzing metadata... {analysisProgress.current}/{analysisProgress.total}
          </p>
        </div>
      )}

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
            onLongPress={handleShowContextMenu}
          />
        )}
      </div>

      {/* Context Menu */}
      {contextMenuTrack && (
        <TrackContextMenu
          track={contextMenuTrack}
          onClose={() => setContextMenuTrack(null)}
          onPlayNext={handlePlayNext}
        />
      )}
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
  onLongPress: (track: CachedTrackEntity) => void;
}

function CachedTracksList({ tracks, onDelete, onPlay, onLongPress }: CachedTracksListProps) {
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggeredRef = useRef(false);
  const longPressStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const handleLongPressStart = (track: CachedTrackEntity, e: React.TouchEvent | React.MouseEvent) => {
    longPressTriggeredRef.current = false;

    if ('touches' in e) {
      longPressStartPosRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }

    longPressTimerRef.current = setTimeout(() => {
      longPressTriggeredRef.current = true;
      onLongPress(track);
    }, 500);
  };

  const handleLongPressMove = (e: React.TouchEvent) => {
    if (longPressStartPosRef.current && longPressTimerRef.current) {
      const touch = e.touches[0];
      const deltaX = Math.abs(touch.clientX - longPressStartPosRef.current.x);
      const deltaY = Math.abs(touch.clientY - longPressStartPosRef.current.y);

      if (deltaX > 10 || deltaY > 10) {
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        longPressStartPosRef.current = null;
      }
    }
  };

  const handleLongPressEnd = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartPosRef.current = null;
  };
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
          onClick={() => {
            if (longPressTriggeredRef.current) return;
            onPlay(track);
          }}
          onTouchStart={(e) => handleLongPressStart(track, e)}
          onTouchMove={handleLongPressMove}
          onTouchEnd={handleLongPressEnd}
          onMouseDown={(e) => handleLongPressStart(track, e)}
          onMouseUp={handleLongPressEnd}
          onMouseLeave={handleLongPressEnd}
          className="w-full flex items-center gap-4 p-4 hover:bg-slate-800 transition-colors text-left"
        >
          <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
            {track.coverArt ? (
              <img src={track.coverArt} alt="Cover" className="w-full h-full object-cover" />
            ) : (
              <Music className="w-5 h-5 text-emerald-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-white truncate">
              {track.title || track.fileName}
            </p>
            <p className="text-xs text-slate-400 truncate">
              {track.artist || track.channelName} • {formatFileSize(track.fileSize)}
              {/* Actual codec of the stored file, so a transcode that didn't
                  happen is visible instead of hidden behind the original name */}
              {track.audioFormat && (
                <span className="ml-1 text-emerald-400">
                  • {track.audioFormat}
                  {track.audioBitrate ? ` ${track.audioBitrate}k` : ''}
                </span>
              )}
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
