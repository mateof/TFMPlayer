import { X, ListPlus, Music } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { t } from '@/i18n';
import type { Track } from '@/types/models';

interface TrackContextMenuProps {
  track: Track;
  onClose: () => void;
  onPlayNext: (track: Track) => void;
  coverArt?: string | null;
}

export function TrackContextMenu({ track, onClose, onPlayNext, coverArt }: TrackContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Delay to prevent immediate close from the long press event
    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside as EventListener);
    }, 100);
    return () => {
      clearTimeout(timeout);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside as EventListener);
    };
  }, [onClose]);

  const handlePlayNext = () => {
    onPlayNext(track);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 animate-in fade-in duration-200">
      <div
        ref={menuRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('Options for {name}', { name: track.title || track.fileName })}
        className="w-full max-w-lg bg-slate-800 rounded-t-2xl overflow-hidden animate-in slide-in-from-bottom duration-300"
      >
        {/* Track info header */}
        <div className="flex items-center gap-4 p-4 border-b border-slate-700">
          <div className="w-14 h-14 bg-slate-700 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
            {coverArt ? (
              <img src={coverArt} alt={t('Cover')} className="w-full h-full object-cover" />
            ) : (
              <Music className="w-7 h-7 text-slate-400" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-base font-medium text-white truncate">
              {track.title || track.fileName}
            </p>
            <p className="text-sm text-slate-400 truncate">
              {track.artist || track.channelName}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white transition-colors"
            aria-label={t('Close')}
          >
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        {/* Menu options */}
        <div className="py-2">
          <button
            onClick={handlePlayNext}
            className="w-full flex items-center gap-4 px-4 py-3 hover:bg-slate-700 transition-colors"
          >
            <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center">
              <ListPlus className="w-5 h-5 text-emerald-400" />
            </div>
            <div className="text-left">
              <p className="text-white font-medium">{t('Play Next')}</p>
              <p className="text-sm text-slate-400">{t('Add to queue after current track')}</p>
            </div>
          </button>
        </div>

        {/* Safe area padding for bottom */}
        <div className="h-6 bg-slate-800" />
      </div>
    </div>
  );
}
