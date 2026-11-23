import { X } from 'lucide-react';
import { useDialog } from '@/hooks/useDialog';
import { displayPath, type ManageKind } from '@/services/files/fileManager';
import { formatFileSize } from '@/utils/format';
import type { ChannelFile } from '@/types/models';
import { FileThumb } from './FileIcon';
import { t } from '@/i18n';

export interface EntryAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

interface FileDetailsSheetProps {
  file: ChannelFile;
  kind: ManageKind;
  thumbnailUrl?: string;
  actions: EntryAction[];
  onClose: () => void;
}

function formatDateTime(value?: string): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

const categoryLabels: Record<string, string> = {
  Folder: 'Folder',
  Audio: 'Audio',
  Video: 'Video',
  Photo: 'Photo',
  Document: 'Document',
  Archive: 'Archive',
  Application: 'Application',
  Other: 'Other'
};

/**
 * Bottom sheet (phones) / side dialog (desktop) with the properties of an
 * entry and the actions that apply to it.
 */
export function FileDetailsSheet({ file, kind, thumbnailUrl, actions, onClose }: FileDetailsSheetProps) {
  const dialogProps = useDialog(onClose, 'file-details-title');
  const isFolder = file.category === 'Folder';

  const rows: [string, string | undefined | null][] = [
    [t('Type'), `${t(categoryLabels[file.category] ?? 'Other')}${!isFolder && file.type ? ` (${file.type})` : ''}`],
    [t('Size'), isFolder ? undefined : `${file.sizeText ?? formatFileSize(file.size)}${file.size ? ` · ${file.size.toLocaleString()} B` : ''}`],
    [t('Location'), displayPath(file, kind)],
    [t('Created'), formatDateTime(file.dateCreated)],
    [t('Modified'), formatDateTime(file.dateModified)],
    [t('Telegram message'), file.messageId ? String(file.messageId) : undefined],
    [t('Split in several messages'), file.isSplit ? t('Yes') : undefined],
    ['MD5', file.md5Hash],
    ['xxHash', file.xxHash]
  ];

  return (
    <div className="fixed inset-0 z-[65] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        {...dialogProps}
        className="relative w-full sm:max-w-md max-h-[85vh] flex flex-col bg-slate-800 rounded-t-2xl sm:rounded-2xl shadow-2xl outline-none safe-area-bottom"
      >
        <div className="flex items-start gap-3 p-5 pb-3">
          <FileThumb file={file} thumbnailUrl={thumbnailUrl} className="w-14 h-14" />
          <div className="flex-1 min-w-0">
            <h2 id="file-details-title" className="text-white font-semibold break-words">{file.name}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{t(categoryLabels[file.category] ?? 'Other')}</p>
          </div>
          <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-white" aria-label={t('Close')}>
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {rows.filter(([, value]) => !!value).map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-slate-400">{label}</dt>
                <dd className="text-slate-200 break-all select-text">{value}</dd>
              </div>
            ))}
          </dl>

          {actions.length > 0 && (
            <div className="mt-5 mb-4 grid grid-cols-2 gap-2" role="group" aria-label={t('Actions')}>
              {actions.map((action) => (
                <button
                  key={action.id}
                  onClick={action.onClick}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm text-left transition-colors ${
                    action.danger ? 'bg-red-500/15 text-red-300 hover:bg-red-500/25' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                  }`}
                >
                  {action.icon}
                  <span className="truncate">{action.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
