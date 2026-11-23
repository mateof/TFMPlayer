import {
  X, CheckSquare, Square, Loader2, Scissors, Copy, Trash2, Download, ServerCog, Zap, Pencil,
  ClipboardPaste, FolderInput, Info
} from 'lucide-react';
import type { ManageOperation } from '@/services/files/fileManager';
import type { FileClipboard } from '@/services/files/clipboard';
import { t } from '@/i18n';

interface ManageSelectionBarProps {
  count: number;
  total: number;
  busy?: boolean;
  operations: ReadonlySet<ManageOperation>;
  /** Some of the selection are files (folders can't go to the device). */
  hasFiles: boolean;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onCancel: () => void;
  onCut: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onDownloadToServer: () => void;
  onPreload: () => void;
  onRename: () => void;
  onDetails: () => void;
}

const actionClass =
  'flex flex-col items-center justify-center gap-1 min-w-[4.5rem] px-2 py-1.5 rounded-lg text-xs text-slate-200 bg-slate-700 hover:bg-slate-600 disabled:opacity-40 transition-colors shrink-0';

/** Selection bar of Manage mode: the file operations that apply to the selection. */
export function ManageSelectionBar(props: ManageSelectionBarProps) {
  const { count, total, busy = false, operations: ops, hasFiles } = props;
  const allSelected = count > 0 && count === total;
  const none = busy || count === 0;

  return (
    <div className="bg-emerald-900/40 border-b border-emerald-700" role="toolbar" aria-label={t('Selection actions')}>
      <div className="flex items-center gap-2 px-4 py-2">
        <button onClick={props.onCancel} className="p-2 text-slate-300 hover:text-white" aria-label={t('Exit selection')}>
          <X className="w-5 h-5" aria-hidden />
        </button>
        <span className="text-sm text-white font-medium" aria-live="polite">{t('{count} selected', { count })}</span>
        {busy && <Loader2 className="w-4 h-4 animate-spin text-emerald-300" aria-label={t('Working...')} />}
        <div className="flex-1" />
        <button
          onClick={allSelected ? props.onDeselectAll : props.onSelectAll}
          disabled={busy}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-slate-700 text-slate-200 rounded-lg disabled:opacity-50"
        >
          {allSelected ? <Square className="w-4 h-4" aria-hidden /> : <CheckSquare className="w-4 h-4" aria-hidden />}
          {allSelected ? t('None') : t('All')}
        </button>
      </div>

      <div className="flex items-stretch gap-2 px-4 pb-2 overflow-x-auto no-scrollbar">
        {ops.has('move') && (
          <button onClick={props.onCut} disabled={none} className={actionClass}>
            <Scissors className="w-4 h-4" aria-hidden />
            {t('Cut')}
          </button>
        )}
        {ops.has('copy') && (
          <button onClick={props.onCopy} disabled={none} className={actionClass}>
            <Copy className="w-4 h-4" aria-hidden />
            {t('Copy')}
          </button>
        )}
        {ops.has('downloadToDevice') && (
          <button onClick={props.onDownload} disabled={none || !hasFiles} className={actionClass}>
            <Download className="w-4 h-4" aria-hidden />
            {t('Download')}
          </button>
        )}
        {ops.has('downloadToServer') && (
          <button onClick={props.onDownloadToServer} disabled={none} className={actionClass}>
            <ServerCog className="w-4 h-4" aria-hidden />
            {t('To server')}
          </button>
        )}
        {ops.has('preload') && (
          <button onClick={props.onPreload} disabled={none} className={actionClass}>
            <Zap className="w-4 h-4" aria-hidden />
            {t('Preload')}
          </button>
        )}
        {ops.has('rename') && (
          <button onClick={props.onRename} disabled={busy || count !== 1} className={actionClass}>
            <Pencil className="w-4 h-4" aria-hidden />
            {t('Rename')}
          </button>
        )}
        <button onClick={props.onDetails} disabled={busy || count !== 1} className={actionClass}>
          <Info className="w-4 h-4" aria-hidden />
          {t('Details')}
        </button>
        {ops.has('delete') && (
          <button onClick={props.onDelete} disabled={none} className={`${actionClass} !text-red-300 !bg-red-500/15 hover:!bg-red-500/25`}>
            <Trash2 className="w-4 h-4" aria-hidden />
            {t('Delete')}
          </button>
        )}
      </div>
    </div>
  );
}

interface PasteBarProps {
  clip: FileClipboard;
  canPasteHere: boolean;
  onPasteHere: () => void;
  onChooseFolder: () => void;
  onClear: () => void;
}

/** Shown while there is something cut/copied that can go into this folder. */
export function PasteBar({ clip, canPasteHere, onPasteHere, onChooseFolder, onClear }: PasteBarProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-sky-500/10 border-b border-slate-700 text-sm" role="region" aria-label={t('Clipboard')}>
      <ClipboardPaste className="w-4 h-4 text-sky-300 shrink-0" aria-hidden />
      <p className="flex-1 min-w-0 truncate text-sky-100">
        {clip.mode === 'cut'
          ? t('{count} item(s) to move', { count: clip.files.length })
          : t('{count} item(s) to copy', { count: clip.files.length })}
      </p>
      <button onClick={onPasteHere} disabled={!canPasteHere} className="px-3 py-1.5 rounded-lg bg-sky-500 text-white text-xs font-medium hover:bg-sky-600 whitespace-nowrap disabled:opacity-50">
        {t('Paste here')}
      </button>
      <button onClick={onChooseFolder} className="p-1.5 rounded-lg bg-slate-700 text-slate-200 hover:bg-slate-600" aria-label={t('Choose another folder')} title={t('Choose another folder')}>
        <FolderInput className="w-4 h-4" aria-hidden />
      </button>
      <button onClick={onClear} className="p-1.5 text-slate-400 hover:text-white" aria-label={t('Empty the clipboard')} title={t('Empty the clipboard')}>
        <X className="w-4 h-4" aria-hidden />
      </button>
    </div>
  );
}
