import { X, CheckSquare, Square, ListPlus, Download, ListEnd, Loader2 } from 'lucide-react';

interface SelectionBarProps {
  count: number;
  total: number;
  busy?: boolean;
  busyLabel?: string;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onAddToPlaylist: () => void;
  onDownload: () => void;
  onPlayNext: () => void;
  onCancel: () => void;
}

// Action bar shown while a list screen is in multi-selection mode. Replaces
// the normal toolbar so the actions apply to the whole selection.
export function SelectionBar({
  count,
  total,
  busy = false,
  busyLabel,
  onSelectAll,
  onDeselectAll,
  onAddToPlaylist,
  onDownload,
  onPlayNext,
  onCancel
}: SelectionBarProps) {
  const allSelected = count > 0 && count === total;
  const disabled = busy || count === 0;

  return (
    <div className="bg-emerald-900/40 border-b border-emerald-700">
      {/* Count + select all/none */}
      <div className="flex items-center gap-2 px-4 py-2">
        <button
          onClick={onCancel}
          className="p-2 text-slate-300 hover:text-white transition-colors"
          aria-label="Exit selection"
        >
          <X className="w-5 h-5" />
        </button>
        <span className="text-sm text-white font-medium">
          {count} selected
        </span>

        <div className="flex-1" />

        <button
          onClick={allSelected ? onDeselectAll : onSelectAll}
          disabled={busy}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-700 text-slate-200 rounded-lg disabled:opacity-50 transition-colors"
        >
          {allSelected ? <Square className="w-4 h-4" /> : <CheckSquare className="w-4 h-4" />}
          {allSelected ? 'None' : 'All'}
        </button>
      </div>

      {/* Bulk actions */}
      <div className="flex items-center gap-2 px-4 pb-2">
        <button
          onClick={onAddToPlaylist}
          disabled={disabled}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          <ListPlus className="w-4 h-4" />
          Playlist
        </button>
        <button
          onClick={onDownload}
          disabled={disabled}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-700 text-slate-200 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          Download
        </button>
        <button
          onClick={onPlayNext}
          disabled={disabled}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-slate-700 text-slate-200 rounded-lg text-sm font-medium disabled:opacity-50 transition-colors"
        >
          <ListEnd className="w-4 h-4" />
          Play next
        </button>
      </div>

      {/* Progress while folders are being expanded */}
      {busy && (
        <div className="flex items-center gap-2 px-4 pb-2 text-xs text-emerald-300">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>{busyLabel || 'Working...'}</span>
        </div>
      )}
    </div>
  );
}
