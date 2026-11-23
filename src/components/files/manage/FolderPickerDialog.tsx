import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Folder, Home, Loader2 } from 'lucide-react';
import { useDialog } from '@/hooks/useDialog';
import { listFolders, type FileManagerTarget, type FolderRef } from '@/services/files/fileManager';
import { t } from '@/i18n';

interface FolderPickerDialogProps {
  target: FileManagerTarget;
  title: string;
  confirmLabel: string;
  /** Folder ids/paths that can't be chosen (the entries being moved). */
  disabledLocations?: ReadonlySet<string>;
  onPick: (folder: FolderRef) => void;
  onClose: () => void;
}

const ROOT: FolderRef = { location: '', path: '', name: '' };

/** Browse the folders of a target and choose one (copy/move destination). */
export function FolderPickerDialog({ target, title, confirmLabel, disabledLocations, onPick, onClose }: FolderPickerDialogProps) {
  const dialogProps = useDialog(onClose, 'folder-picker-title');
  const [trail, setTrail] = useState<FolderRef[]>([]);
  const current = trail[trail.length - 1] ?? ROOT;

  const query = useQuery({
    queryKey: ['folder-picker', target.key, current.location],
    queryFn: ({ signal }) => listFolders(target, current.location, signal),
    retry: false
  });

  const open = (folder: FolderRef) => setTrail((prev) => [...prev, folder]);
  const choose = () => {
    const path = target.kind === 'local' ? current.location : query.data?.currentPath ?? (current.location ? current.path : '/');
    onPick({ ...current, path });
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        {...dialogProps}
        className="relative w-full max-w-md max-h-[80vh] flex flex-col bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl outline-none safe-area-bottom"
      >
        <div className="px-5 pt-5 pb-3">
          <h2 id="folder-picker-title" className="text-white font-semibold">{title}</h2>
          <nav aria-label={t('Folder path')} className="mt-2 flex items-center gap-1 text-sm overflow-x-auto no-scrollbar">
            <button onClick={() => setTrail([])} className="flex items-center gap-1 text-emerald-400 hover:underline whitespace-nowrap">
              <Home className="w-4 h-4" aria-hidden />
              {t('Root')}
            </button>
            {trail.map((f, i) => (
              <span key={`${i}-${f.location}`} className="flex items-center gap-1">
                <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" aria-hidden />
                <button
                  onClick={() => setTrail(trail.slice(0, i + 1))}
                  aria-current={i === trail.length - 1 ? 'location' : undefined}
                  className={`whitespace-nowrap ${i === trail.length - 1 ? 'text-white' : 'text-emerald-400 hover:underline'}`}
                >
                  {f.name}
                </button>
              </span>
            ))}
          </nav>
        </div>

        <div className="flex-1 min-h-[12rem] overflow-y-auto border-y border-slate-700">
          {query.isPending ? (
            <div className="flex items-center justify-center gap-2 py-10 text-slate-400" role="status">
              <Loader2 className="w-5 h-5 animate-spin" aria-hidden />
              {t('Loading folders...')}
            </div>
          ) : query.isError ? (
            <p className="py-10 text-center text-sm text-red-400" role="alert">{t('Could not load the folders')}</p>
          ) : query.data.folders.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-400">{t('No subfolders here')}</p>
          ) : (
            <ul aria-label={t('Folders')}>
              {query.data.folders.map((folder) => {
                const location = target.kind === 'local' ? folder.path : folder.id;
                const disabled = disabledLocations?.has(location) ?? false;
                return (
                  <li key={folder.id}>
                    <button
                      onClick={() => open({ location, path: target.kind === 'local' ? folder.path : '', name: folder.name })}
                      disabled={disabled}
                      className="w-full flex items-center gap-3 px-5 py-3 text-left text-sm text-slate-200 hover:bg-slate-700/60 disabled:opacity-40 focus-visible:bg-slate-700 outline-none"
                    >
                      <Folder className="w-5 h-5 text-yellow-400 shrink-0" aria-hidden />
                      <span className="flex-1 truncate">{folder.name}</span>
                      <ChevronRight className="w-4 h-4 text-slate-500" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="p-4 flex items-center gap-2">
          <p className="flex-1 min-w-0 text-xs text-slate-400 truncate">
            {t('Destination: {name}', { name: current.name || t('Root') })}
          </p>
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-700 text-slate-200 text-sm font-medium hover:bg-slate-600">
            {t('Cancel')}
          </button>
          <button
            onClick={choose}
            disabled={query.isPending || (disabledLocations?.has(current.location) ?? false)}
            className="px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
