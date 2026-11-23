import { useEffect, useLayoutEffect, useState, type ReactNode, type RefObject } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { ChannelFile } from '@/types/models';
import { t } from '@/i18n';

const MIN_TILE = 132;
const GAP = 12;

interface FileGridProps {
  files: ChannelFile[];
  totalCount: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  /** Called when the last rows come into view (infinite scroll). */
  onNearEnd: () => void;
  renderTile: (file: ChannelFile, index: number, onKeyDown: (e: React.KeyboardEvent) => void) => ReactNode;
  /** Keys the grid doesn't handle itself (Enter, Space, Escape...). */
  onTileKey: (file: ChannelFile, index: number, e: React.KeyboardEvent) => void;
}

/** Virtualized grid of tiles (rows of as many columns as fit), for Manage mode. */
export function FileGrid({ files, totalCount, scrollRef, onNearEnd, renderTile, onTileKey }: FileGridProps) {
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, [scrollRef]);

  const inner = Math.max(0, width - 32); // px-4 gutters
  const columns = Math.max(2, Math.floor((inner + GAP) / (MIN_TILE + GAP)));
  const tileWidth = inner > 0 ? (inner - GAP * (columns - 1)) / columns : MIN_TILE;
  const rowHeight = Math.round(tileWidth + 52 + GAP);
  const rowCount = Math.ceil(files.length / columns);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 3
  });

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

  const rows = virtualizer.getVirtualItems();
  const lastRow = rows.length > 0 ? rows[rows.length - 1].index : -1;
  useEffect(() => {
    if (lastRow >= rowCount - 3) onNearEnd();
  }, [lastRow, rowCount, onNearEnd]);

  const focusIndex = (index: number) => {
    if (index < 0 || index >= files.length) return;
    virtualizer.scrollToIndex(Math.floor(index / columns), { align: 'auto' });
    requestAnimationFrame(() => {
      scrollRef.current?.querySelector<HTMLElement>(`[data-row-index="${index}"]`)?.focus();
    });
  };

  const keyHandler = (file: ChannelFile, index: number) => (e: React.KeyboardEvent) => {
    const moves: Record<string, number> = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -columns,
      ArrowDown: columns
    };
    if (e.key in moves) {
      e.preventDefault();
      e.stopPropagation();
      focusIndex(index + moves[e.key]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      focusIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      focusIndex(files.length - 1);
    } else {
      onTileKey(file, index, e);
    }
  };

  return (
    <div
      role="grid"
      aria-label={t('{count} of {total} files', { count: files.length, total: totalCount })}
      aria-colcount={columns}
      className="relative w-full"
      style={{ height: virtualizer.getTotalSize() }}
    >
      {rows.map((row) => {
        const start = row.index * columns;
        return (
          <div
            key={row.key}
            role="row"
            className="absolute left-0 top-0 w-full px-4 grid"
            style={{
              transform: `translateY(${row.start}px)`,
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              columnGap: GAP,
              paddingTop: GAP
            }}
          >
            {files.slice(start, start + columns).map((file, i) => renderTile(file, start + i, keyHandler(file, start + i)))}
          </div>
        );
      })}
    </div>
  );
}
