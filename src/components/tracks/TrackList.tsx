import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Music, Check, ListPlus, Download, Plus, HardDrive } from 'lucide-react';
import { PlaylistPicker } from '@/components/playlists/PlaylistPicker';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useCachedTrackIds } from '@/hooks/useCachedTrackIds';
import { useMediaQuery, DESKTOP_QUERY } from '@/hooks/useMediaQuery';
import { downloadManager, useDownloadStore } from '@/services/download/DownloadManager';
import { useUiStore } from '@/stores/uiStore';
import { setDragPayload } from '@/utils/dragTracks';
import { t } from '@/i18n';
import type { Track } from '@/types/models';

interface TrackListProps {
  tracks: Track[];
  /** Defaults to playing the whole list from the clicked track. */
  onPlay?: (index: number) => void;
  /** Extra line under the title (plays, date...). */
  renderMeta?: (track: Track, index: number) => ReactNode;
  emptyText?: string;
  label: string;
}

const ROW_HEIGHT = 64;

/**
 * Virtualized list of tracks with the usual per-row actions. Owns its scroll
 * container: give it a parent with a definite height (flex-1 min-h-0).
 */
export function TrackList({ tracks, onPlay, renderMeta, emptyText, label }: TrackListProps) {
  const { play, playNext, currentTrack, isPlaying } = useAudioPlayer();
  const addToast = useUiStore((s) => s.addToast);
  const activeDownloads = useDownloadStore((s) => s.activeDownloads);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [pickerTracks, setPickerTracks] = useState<Track[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cached = useCachedTrackIds(useMemo(() => tracks.map((tr) => tr.fileId), [tracks]));

  const virtualizer = useVirtualizer({
    count: tracks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10
  });

  const playAt = (index: number) => {
    if (onPlay) onPlay(index);
    else play(tracks[index], tracks, index);
  };

  const focusRow = (index: number) => {
    if (index < 0 || index >= tracks.length) return;
    virtualizer.scrollToIndex(index, { align: 'auto' });
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-row="${index}"]`)?.focus();
    });
  };

  if (tracks.length === 0) {
    return <p className="px-4 py-12 text-center text-slate-400">{emptyText ?? t('Nothing here yet')}</p>;
  }

  return (
    <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto">
      <div role="list" aria-label={label} className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const track = tracks[row.index];
          const isCurrent = currentTrack?.fileId === track.fileId;
          const isCached = cached.has(track.fileId);
          const action = (labelText: string, icon: ReactNode, onClick: () => void) => (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClick();
              }}
              className="p-2 text-slate-500 hover:text-emerald-400 transition-colors"
              aria-label={`${labelText}: ${track.title || track.fileName}`}
              title={labelText}
            >
              {icon}
            </button>
          );
          return (
            <div
              key={`${track.fileId}-${row.index}`}
              data-index={row.index}
              data-row={row.index}
              ref={virtualizer.measureElement}
              role="listitem"
              tabIndex={0}
              aria-current={isCurrent ? 'true' : undefined}
              aria-label={`${track.title || track.fileName}${isCached ? `, ${t('on device')}` : ''}`}
              onClick={() => playAt(row.index)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  playAt(row.index);
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  e.stopPropagation();
                  focusRow(row.index + (e.key === 'ArrowDown' ? 1 : -1));
                }
              }}
              draggable={isDesktop}
              onDragStart={(e) => setDragPayload(e, [{ kind: 'track', track }])}
              className={`group absolute left-0 top-0 w-full flex items-center gap-3 px-4 py-2.5 border-b border-slate-800 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400 ${
                isCurrent ? 'bg-emerald-500/10' : 'hover:bg-slate-800/70'
              }`}
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <div className="relative w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center shrink-0" aria-hidden>
                {isCurrent && isPlaying ? (
                  <div className="flex items-end gap-0.5 h-4">
                    <span className="w-1 bg-emerald-400 animate-[eq_0.9s_ease-in-out_infinite]" />
                    <span className="w-1 bg-emerald-400 animate-[eq_0.9s_ease-in-out_0.2s_infinite]" />
                    <span className="w-1 bg-emerald-400 animate-[eq_0.9s_ease-in-out_0.4s_infinite]" />
                  </div>
                ) : track.isLocalFile ? (
                  <HardDrive className="w-4 h-4 text-slate-400" />
                ) : (
                  <Music className={`w-4 h-4 ${isCurrent ? 'text-emerald-400' : 'text-slate-400'}`} />
                )}
                {isCached && (
                  <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-white" />
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${isCurrent ? 'text-emerald-400' : 'text-white'}`} title={track.fileName}>
                  {track.title || track.fileName}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {renderMeta ? renderMeta(track, row.index) : track.artist || track.channelName}
                </p>
              </div>
              <div className="flex items-center lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                {action(t('Play next'), <ListPlus className="w-5 h-5" aria-hidden />, () => {
                  playNext(track);
                  addToast(t('Will play next'), 'success');
                })}
                {!isCached && !activeDownloads.has(track.fileId) &&
                  action(t('Download'), <Download className="w-5 h-5" aria-hidden />, async () => {
                    await downloadManager.addToQueue(track);
                    addToast(t('Added to download queue'), 'info');
                  })}
                {action(t('Add to playlist'), <Plus className="w-5 h-5" aria-hidden />, () => setPickerTracks([track]))}
              </div>
            </div>
          );
        })}
      </div>
      {pickerTracks && <PlaylistPicker tracks={pickerTracks} onClose={() => setPickerTracks(null)} />}
    </div>
  );
}
