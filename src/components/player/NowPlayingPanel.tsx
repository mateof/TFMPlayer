import { useEffect, useRef, useState } from 'react';
import { Music, X, HardDrive, Radio, CloudDownload, Volume2 } from 'lucide-react';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useUiStore } from '@/stores/uiStore';
import { db } from '@/db/database';
import { formatDuration, formatFileSize } from '@/utils/format';

// Rendering thousands of rows for a long channel queue is wasted work:
// the panel shows a window of what is coming next
const UPCOMING_LIMIT = 100;

interface CachedInfo {
  coverArt?: string;
  audioFormat?: string;
  audioBitrate?: number;
  cached: boolean;
}

/** Desktop right-hand panel: current track details and the upcoming queue. */
export function NowPlayingPanel() {
  const toggle = useUiStore((s) => s.toggleNowPlayingPanel);
  const { currentTrack, queue, currentIndex, duration, playAtIndex } = useAudioPlayer();
  const [info, setInfo] = useState<CachedInfo>({ cached: false });
  const currentRowRef = useRef<HTMLButtonElement>(null);

  const fileId = currentTrack?.fileId;
  useEffect(() => {
    if (!fileId) return;
    let cancelled = false;
    db.cachedTracks.get(fileId).then((cached) => {
      if (cancelled) return;
      setInfo({
        coverArt: cached?.coverArt,
        audioFormat: cached?.audioFormat,
        audioBitrate: cached?.audioBitrate,
        cached: !!cached
      });
    }).catch(() => setInfo({ cached: false }));
    return () => {
      cancelled = true;
    };
  }, [fileId]);

  useEffect(() => {
    currentRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [currentIndex]);

  if (!currentTrack) return null;

  const extension = currentTrack.fileName.includes('.')
    ? currentTrack.fileName.split('.').pop()!.toUpperCase()
    : currentTrack.fileType;
  const upcoming = queue.slice(currentIndex, currentIndex + UPCOMING_LIMIT + 1);
  const remaining = queue.length - currentIndex - upcoming.length;

  const details: { label: string; value: string }[] = [
    { label: 'Format', value: info.audioFormat ? `${info.audioFormat}${info.audioBitrate ? ` · ${info.audioBitrate} kbps` : ''}` : extension },
    { label: 'Size', value: currentTrack.fileSize ? formatFileSize(currentTrack.fileSize) : '—' },
    { label: 'Duration', value: duration ? formatDuration(duration) : '—' },
    { label: 'Source', value: currentTrack.isLocalFile ? 'Server local files' : currentTrack.channelName || 'Channel' }
  ];

  return (
    <aside className="w-80 h-full min-h-0 flex flex-col bg-slate-950 border-l border-slate-800">
      <div className="flex items-center justify-between px-4 h-14 shrink-0">
        <span className="text-sm font-semibold text-white">Now playing</span>
        <button onClick={toggle} className="p-1.5 text-slate-400 hover:text-white" title="Hide panel">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-4 space-y-5">
        <div className="aspect-square w-full rounded-xl bg-slate-800 overflow-hidden flex items-center justify-center shadow-lg">
          {info.coverArt ? (
            <img src={info.coverArt} alt="" className="w-full h-full object-cover" />
          ) : (
            <Music className="w-16 h-16 text-slate-600" />
          )}
        </div>

        <div>
          <p className="text-lg font-semibold text-white leading-tight break-words">
            {currentTrack.title || currentTrack.fileName}
          </p>
          {currentTrack.artist && <p className="text-sm text-slate-300 mt-1">{currentTrack.artist}</p>}
          {currentTrack.album && <p className="text-sm text-slate-400">{currentTrack.album}</p>}
          {currentTrack.title && (
            <p className="text-xs text-slate-500 mt-1 break-all">{currentTrack.fileName}</p>
          )}
        </div>

        <div className="rounded-lg bg-slate-900 divide-y divide-slate-800 text-sm">
          {details.map((d) => (
            <div key={d.label} className="flex justify-between gap-3 px-3 py-2">
              <span className="text-slate-500">{d.label}</span>
              <span className="text-slate-200 text-right truncate">{d.value}</span>
            </div>
          ))}
          <div className="flex justify-between gap-3 px-3 py-2">
            <span className="text-slate-500">Offline</span>
            <span className={`flex items-center gap-1 ${info.cached ? 'text-emerald-400' : 'text-slate-400'}`}>
              {info.cached ? <HardDrive className="w-3.5 h-3.5" /> : <CloudDownload className="w-3.5 h-3.5" />}
              {info.cached ? 'Stored on device' : 'Streaming'}
            </span>
          </div>
        </div>

        <div>
          <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">
            Queue · {currentIndex + 1} of {queue.length}
          </p>
          <div className="space-y-0.5">
            {upcoming.map((track, offset) => {
              const index = currentIndex + offset;
              const isCurrent = offset === 0;
              return (
                <button
                  key={`${track.fileId}-${index}`}
                  ref={isCurrent ? currentRowRef : undefined}
                  onClick={() => !isCurrent && playAtIndex(index)}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm ${
                    isCurrent ? 'bg-emerald-500/10 text-emerald-300' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <span className="w-6 shrink-0 text-xs text-slate-500 tabular-nums text-right">
                    {isCurrent ? <Volume2 className="w-3.5 h-3.5 inline text-emerald-400" /> : index + 1}
                  </span>
                  {track.isLocalFile ? (
                    <HardDrive className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                  ) : (
                    <Radio className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                  )}
                  <span className="truncate">{track.title || track.fileName}</span>
                </button>
              );
            })}
            {remaining > 0 && (
              <p className="px-2 py-1.5 text-xs text-slate-500">+{remaining} more</p>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
