import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, Download, ExternalLink, Info, Loader2, Minus, Plus, RotateCcw, X
} from 'lucide-react';
import { useDialog } from '@/hooks/useDialog';
import { audioPlayer } from '@/services/audio/AudioPlayerService';
import { triggerDownload, viewerKind, type FileManagerTarget } from '@/services/files/fileManager';
import type { ChannelFile } from '@/types/models';
import { FileThumb } from './FileIcon';
import { t } from '@/i18n';

interface MediaViewerProps {
  /** Viewable entries of the current listing, in list order (the gallery). */
  items: ChannelFile[];
  startIndex: number;
  target: FileManagerTarget;
  canDownload: boolean;
  onDetails?: (file: ChannelFile) => void;
  onClose: () => void;
}

const MIN_SCALE = 1;
const MAX_SCALE = 6;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Full-screen viewer for non-audio files: zoomable image gallery (wheel,
 * pinch, double tap, drag), native video/audio player, PDF in a frame (and a
 * new tab, which phones handle better) and plain text.
 */
export function MediaViewer({ items, startIndex, target, canDownload, onDetails, onClose }: MediaViewerProps) {
  const dialogProps = useDialog(onClose, 'media-viewer-title');
  const [index, setIndex] = useState(clamp(startIndex, 0, Math.max(0, items.length - 1)));
  const file = items[index];
  const kind = file ? viewerKind(file) : null;
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  const go = useCallback((delta: number) => {
    setIndex((i) => clamp(i + delta, 0, items.length - 1));
  }, [items.length]);

  // Arrows navigate the gallery instead of seeking the music player
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'VIDEO' || tag === 'AUDIO' || tag === 'INPUT') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        e.stopImmediatePropagation();
        go(e.key === 'ArrowLeft' ? -1 : 1);
      } else if (e.key === ' ') {
        // Space would toggle the music player underneath
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [go]);

  if (!file) return null;
  const url = kind === 'video' || kind === 'audio' ? target.playbackUrl(file) : target.contentUrl(file);
  const downloadUrl = target.contentUrl(file, true);

  return (
    <div {...dialogProps} className="fixed inset-0 z-[75] flex flex-col bg-black/95 outline-none">
      <div className="flex items-center gap-2 px-3 h-14 shrink-0 text-white safe-area-top">
        <div className="flex-1 min-w-0">
          <h2 id="media-viewer-title" className="text-sm font-medium truncate">{file.name}</h2>
          {items.length > 1 && (
            <p className="text-xs text-white/60 tabular-nums">{t('{index} of {total}', { index: index + 1, total: items.length })}</p>
          )}
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="p-2 rounded-lg hover:bg-white/10"
            aria-label={t('Open in a new tab')}
            title={t('Open in a new tab')}
          >
            <ExternalLink className="w-5 h-5" aria-hidden />
          </a>
        )}
        {canDownload && downloadUrl && (
          <button
            onClick={() => triggerDownload(downloadUrl, file.name)}
            className="p-2 rounded-lg hover:bg-white/10"
            aria-label={t('Download to this device')}
            title={t('Download to this device')}
          >
            <Download className="w-5 h-5" aria-hidden />
          </button>
        )}
        {onDetails && (
          <button onClick={() => onDetails(file)} className="p-2 rounded-lg hover:bg-white/10" aria-label={t('Details')} title={t('Details')}>
            <Info className="w-5 h-5" aria-hidden />
          </button>
        )}
        <button onClick={onClose} className="p-2 rounded-lg hover:bg-white/10" aria-label={t('Close')} title={t('Close')}>
          <X className="w-5 h-5" aria-hidden />
        </button>
      </div>

      <div className="relative flex-1 min-h-0 flex items-center justify-center">
        {!url ? (
          <p className="text-white/70 text-sm">{t('This file cannot be shown')}</p>
        ) : kind === 'image' ? (
          <ZoomableImage key={file.id} src={url} alt={file.name} onSwipe={go} />
        ) : kind === 'video' ? (
          <video
            key={file.id}
            src={url}
            controls
            autoPlay
            playsInline
            poster={target.thumbnailUrl(file)}
            onPlay={() => audioPlayer.pause()}
            className="max-w-full max-h-full"
          />
        ) : kind === 'audio' ? (
          <div className="flex flex-col items-center gap-6 px-6 w-full max-w-md">
            <FileThumb file={file} className="w-28 h-28" rounded="rounded-2xl" />
            <audio key={file.id} src={url} controls autoPlay onPlay={() => audioPlayer.pause()} className="w-full" />
          </div>
        ) : kind === 'pdf' ? (
          <PdfView key={file.id} src={url} name={file.name} />
        ) : kind === 'text' ? (
          <TextView key={file.id} src={url} />
        ) : (
          <div className="flex flex-col items-center gap-4 text-white/80">
            <FileThumb file={file} className="w-24 h-24" rounded="rounded-2xl" />
            <p className="text-sm">{t('No preview for this type of file')}</p>
          </div>
        )}

        {hasPrev && (
          <button
            onClick={() => go(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
            aria-label={t('Previous')}
          >
            <ChevronLeft className="w-6 h-6" aria-hidden />
          </button>
        )}
        {hasNext && (
          <button
            onClick={() => go(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white hover:bg-black/70"
            aria-label={t('Next')}
          >
            <ChevronRight className="w-6 h-6" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

/** Image with wheel/pinch/double-tap zoom and drag to pan; swipe changes image when not zoomed. */
function ZoomableImage({ src, alt, onSwipe }: { src: string; alt: string; onSwipe: (delta: number) => void }) {
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ startDist: number; startScale: number; startX: number; startY: number; startOffset: { x: number; y: number }; moved: boolean } | null>(null);
  const lastTap = useRef(0);

  const zoomTo = useCallback((next: number) => {
    const s = clamp(next, MIN_SCALE, MAX_SCALE);
    setScale(s);
    if (s === 1) setOffset({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '+' || e.key === '=') zoomTo(scale * 1.5);
      else if (e.key === '-') zoomTo(scale / 1.5);
      else if (e.key === '0') zoomTo(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [scale, zoomTo]);

  const distance = () => {
    const [a, b] = [...pointers.current.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current = {
      startDist: pointers.current.size === 2 ? distance() : 0,
      startScale: scale,
      startX: e.clientX,
      startY: e.clientY,
      startOffset: offset,
      moved: false
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !gesture.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (pointers.current.size === 2 && g.startDist > 0) {
      g.moved = true;
      zoomTo(g.startScale * (distance() / g.startDist));
    } else if (pointers.current.size === 1) {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) g.moved = true;
      if (scale > 1) setOffset({ x: g.startOffset.x + dx, y: g.startOffset.y + dy });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    const wasSingle = pointers.current.size === 1;
    pointers.current.delete(e.pointerId);
    if (!g || !wasSingle) return;
    const dx = e.clientX - g.startX;
    if (scale === 1 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - g.startY)) {
      onSwipe(dx < 0 ? 1 : -1);
    } else if (!g.moved) {
      // Double tap / double click toggles zoom
      const now = Date.now();
      if (now - lastTap.current < 300) zoomTo(scale > 1 ? 1 : 2.5);
      lastTap.current = now;
    }
    gesture.current = null;
  };

  return (
    <div className="absolute inset-0 overflow-hidden flex items-center justify-center">
      <div
        className="w-full h-full flex items-center justify-center touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={(e) => zoomTo(scale * (e.deltaY < 0 ? 1.2 : 1 / 1.2))}
      >
        {loading && !failed && <Loader2 className="absolute w-8 h-8 text-white/70 animate-spin" aria-hidden />}
        {failed ? (
          <p className="text-white/70 text-sm" role="alert">{t('The image could not be loaded')}</p>
        ) : (
          <img
            src={src}
            alt={alt}
            draggable={false}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setFailed(true);
            }}
            className="max-w-full max-h-full object-contain transition-transform duration-75"
            style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          />
        )}
      </div>
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1 rounded-full bg-black/60 text-white safe-area-bottom">
        <button onClick={() => zoomTo(scale / 1.5)} disabled={scale <= MIN_SCALE} className="p-2 rounded-full hover:bg-white/10 disabled:opacity-40" aria-label={t('Zoom out')}>
          <Minus className="w-4 h-4" aria-hidden />
        </button>
        <span className="w-12 text-center text-xs tabular-nums" aria-live="polite">{Math.round(scale * 100)}%</span>
        <button onClick={() => zoomTo(scale * 1.5)} disabled={scale >= MAX_SCALE} className="p-2 rounded-full hover:bg-white/10 disabled:opacity-40" aria-label={t('Zoom in')}>
          <Plus className="w-4 h-4" aria-hidden />
        </button>
        <button onClick={() => zoomTo(1)} disabled={scale === 1} className="p-2 rounded-full hover:bg-white/10 disabled:opacity-40" aria-label={t('Reset zoom')}>
          <RotateCcw className="w-4 h-4" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function PdfView({ src, name }: { src: string; name: string }) {
  return (
    <div className="w-full h-full flex flex-col">
      <iframe src={src} title={name} className="flex-1 w-full bg-white" />
      <div className="p-3 flex justify-center">
        <a
          href={src}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 text-white text-sm font-medium"
        >
          <ExternalLink className="w-4 h-4" aria-hidden />
          {t('Open the PDF in a new tab')}
        </a>
      </div>
    </div>
  );
}

const TEXT_LIMIT = 256 * 1024;

function TextView({ src }: { src: string }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(src, { signal: controller.signal, headers: { Range: `bytes=0-${TEXT_LIMIT - 1}` } })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then(setText)
      .catch((e: unknown) => {
        if (!(e instanceof DOMException && e.name === 'AbortError')) setError(true);
      });
    return () => controller.abort();
  }, [src]);

  if (error) return <p className="text-white/70 text-sm" role="alert">{t('The file could not be loaded')}</p>;
  if (text === null) return <Loader2 className="w-8 h-8 text-white/70 animate-spin" aria-label={t('Loading...')} />;
  return (
    <pre className="w-full h-full overflow-auto p-4 text-xs text-slate-200 whitespace-pre-wrap break-words font-mono select-text">
      {text}
    </pre>
  );
}
