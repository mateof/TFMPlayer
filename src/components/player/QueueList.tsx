import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { GripVertical, Music, X, Loader2 } from 'lucide-react';
import { usePlayerStore } from '@/stores/playerStore';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { loadNextQueuePage } from '@/services/queue/QueueSourceService';
import { t } from '@/i18n';

interface QueueListProps {
  coverArts: Record<string, string>;
  /** Scroll the current track into view when this becomes true. */
  active?: boolean;
}

const ROW_HEIGHT = 60;

/**
 * The play queue: virtualized (channel queues reach thousands of tracks),
 * drag or Alt+arrows to reorder, pages in more tracks from the channel when
 * scrolled to the end.
 */
export function QueueList({ coverArts, active = true }: QueueListProps) {
  const { queue, currentIndex, isPlaying, playAtIndex } = useAudioPlayer();
  const moveInQueue = usePlayerStore((s) => s.moveInQueue);
  const removeFromQueue = usePlayerStore((s) => s.removeFromQueue);
  const queueSource = usePlayerStore((s) => s.queueSource);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const virtualizer = useVirtualizer({
    count: queue.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8
  });

  useEffect(() => {
    if (active && currentIndex >= 0 && currentIndex < queue.length) {
      virtualizer.scrollToIndex(currentIndex, { align: 'center' });
    }
    // Only when the current track or visibility changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, currentIndex]);

  const items = virtualizer.getVirtualItems();
  const lastIndex = items.length > 0 ? items[items.length - 1].index : -1;
  useEffect(() => {
    if (!queueSource?.hasMore || loadingMore || lastIndex < queue.length - 5) return;
    setLoadingMore(true);
    loadNextQueuePage()
      .catch((e) => console.warn('Failed to load more queue tracks:', e))
      .finally(() => setLoadingMore(false));
  }, [lastIndex, queue.length, queueSource?.hasMore, loadingMore]);

  const focusRow = (index: number) => {
    if (index < 0 || index >= queue.length) return;
    virtualizer.scrollToIndex(index, { align: 'auto' });
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-queue-row="${index}"]`)?.focus();
    });
  };

  return (
    <div ref={scrollRef} data-no-dismiss className="flex-1 min-h-0 overflow-y-auto overscroll-none">
      <div
        role="list"
        aria-label={t('Queue: {count} tracks. Alt+arrows reorder.', { count: queue.length })}
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {items.map((row) => {
          const index = row.index;
          const track = queue[index];
          const isCurrent = index === currentIndex;
          return (
            <div
              key={`${track.fileId}-${index}`}
              data-index={index}
              data-queue-row={index}
              ref={virtualizer.measureElement}
              role="listitem"
              tabIndex={0}
              aria-current={isCurrent ? 'true' : undefined}
              aria-label={`${index + 1}. ${track.title || track.fileName}`}
              draggable
              onDragStart={(e) => {
                setDragFrom(index);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(index));
              }}
              onDragOver={(e) => {
                if (dragFrom === null) return;
                e.preventDefault();
                setDragOver(index);
              }}
              onDragLeave={() => setDragOver(null)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragFrom !== null && dragFrom !== index) moveInQueue(dragFrom, index);
                setDragFrom(null);
                setDragOver(null);
              }}
              onDragEnd={() => {
                setDragFrom(null);
                setDragOver(null);
              }}
              onClick={() => !isCurrent && playAtIndex(index)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === 'Enter') {
                  e.preventDefault();
                  e.stopPropagation();
                  playAtIndex(index);
                } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                  e.preventDefault();
                  e.stopPropagation();
                  const target = index + (e.key === 'ArrowDown' ? 1 : -1);
                  if (e.altKey && target >= 0 && target < queue.length) moveInQueue(index, target);
                  focusRow(target);
                } else if (e.key === 'Delete' && !isCurrent) {
                  e.preventDefault();
                  removeFromQueue(index);
                }
              }}
              className={`group absolute left-0 top-0 w-full flex items-center gap-2 px-2 py-2 rounded-lg cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 transition-colors ${
                isCurrent ? 'bg-emerald-500/15' : 'hover:bg-white/5'
              } ${dragFrom === index ? 'opacity-40' : ''} ${dragOver === index && dragFrom !== index ? 'ring-1 ring-emerald-400' : ''}`}
              style={{ transform: `translateY(${row.start}px)` }}
            >
              <GripVertical className="w-4 h-4 text-slate-600 shrink-0 cursor-grab" aria-hidden />
              <span className="w-7 text-right text-xs text-slate-500 tabular-nums shrink-0">
                {isCurrent && isPlaying ? (
                  <span className="inline-flex items-end gap-0.5 h-3" aria-hidden>
                    <span className="w-0.5 bg-emerald-400 animate-[eq_0.9s_ease-in-out_infinite]" />
                    <span className="w-0.5 bg-emerald-400 animate-[eq_0.9s_ease-in-out_0.2s_infinite]" />
                    <span className="w-0.5 bg-emerald-400 animate-[eq_0.9s_ease-in-out_0.4s_infinite]" />
                  </span>
                ) : (
                  index + 1
                )}
              </span>
              <div className="w-10 h-10 rounded bg-slate-700/80 flex items-center justify-center shrink-0 overflow-hidden" aria-hidden>
                {coverArts[track.fileId] ? (
                  <img src={coverArts[track.fileId]} alt="" className="w-full h-full object-cover" />
                ) : (
                  <Music className="w-4 h-4 text-slate-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm truncate ${isCurrent ? 'text-emerald-400' : 'text-white'}`}>{track.title || track.fileName}</p>
                <p className="text-xs text-slate-400 truncate">{track.artist || track.channelName}</p>
              </div>
              {!isCurrent && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromQueue(index);
                  }}
                  className="p-1.5 text-slate-500 hover:text-red-400 opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={t('Remove {name} from the queue', { name: track.title || track.fileName })}
                  title={t('Remove from queue')}
                >
                  <X className="w-4 h-4" aria-hidden />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {loadingMore && (
        <div className="flex items-center justify-center py-3 gap-2 text-slate-400" role="status">
          <Loader2 className="w-4 h-4 animate-spin" aria-hidden />
          <span className="text-xs">{t('Loading more...')}</span>
        </div>
      )}
      {!loadingMore && queueSource?.hasMore && (
        <p className="py-3 text-center text-xs text-slate-500">
          {t('Scroll down to load more from {name}', { name: queueSource.channelName })}
        </p>
      )}
    </div>
  );
}
