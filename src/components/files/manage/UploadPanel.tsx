import { useState } from 'react';
import { CheckCircle2, ChevronDown, ChevronUp, Upload, X, AlertCircle } from 'lucide-react';
import { cancelUpload, useUploadStore } from '@/services/files/uploadQueue';
import { formatFileSize } from '@/utils/format';
import { t } from '@/i18n';

/** Progress of the uploads started from this device (all targets). */
export function UploadPanel() {
  const items = useUploadStore((s) => s.items);
  const clearFinished = useUploadStore((s) => s.clearFinished);
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;

  const active = items.filter((i) => i.status === 'queued' || i.status === 'uploading');
  const totalBytes = active.reduce((sum, i) => sum + i.size, 0);
  const sentBytes = active.reduce((sum, i) => sum + i.loaded, 0);
  const percent = totalBytes > 0 ? Math.round((sentBytes / totalBytes) * 100) : 100;

  return (
    <section className="border-t border-slate-700 bg-slate-800" aria-label={t('Uploads')}>
      <div className="flex items-center gap-2 px-4 py-2">
        <Upload className="w-4 h-4 text-emerald-400" aria-hidden />
        <p className="flex-1 text-sm text-slate-200" role="status">
          {active.length > 0
            ? t('Uploading {count} file(s) · {percent}%', { count: active.length, percent })
            : t('Uploads finished')}
        </p>
        {active.length < items.length && (
          <button onClick={clearFinished} className="text-xs text-slate-400 hover:text-white px-2 py-1">
            {t('Clear')}
          </button>
        )}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="p-1 text-slate-400 hover:text-white"
          aria-expanded={!collapsed}
          aria-label={collapsed ? t('Show uploads') : t('Hide uploads')}
        >
          {collapsed ? <ChevronUp className="w-4 h-4" aria-hidden /> : <ChevronDown className="w-4 h-4" aria-hidden />}
        </button>
      </div>
      {!collapsed && (
        <ul className="max-h-40 overflow-y-auto px-4 pb-2 space-y-1.5">
          {items.map((item) => {
            const pct = item.size > 0 ? Math.round((item.loaded / item.size) * 100) : 0;
            return (
              <li key={item.id} className="flex items-center gap-2 text-xs">
                {item.status === 'done' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" aria-label={t('Uploaded')} />
                ) : item.status === 'error' ? (
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0" aria-label={t('Failed')} />
                ) : null}
                <div className="flex-1 min-w-0">
                  <p className="truncate text-slate-200" title={item.error ?? item.name}>{item.name}</p>
                  {(item.status === 'uploading' || item.status === 'queued') && (
                    <div
                      className="mt-1 h-1 rounded-full bg-slate-700 overflow-hidden"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={pct}
                      aria-label={t('Upload of {name}', { name: item.name })}
                    >
                      <div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                  {item.status === 'error' && <p className="text-red-400 truncate">{item.error}</p>}
                  {item.status === 'canceled' && <p className="text-slate-500">{t('Canceled')}</p>}
                </div>
                <span className="text-slate-400 tabular-nums shrink-0">
                  {item.status === 'uploading' ? `${formatFileSize(item.loaded)} / ${formatFileSize(item.size)}` : formatFileSize(item.size)}
                </span>
                {(item.status === 'uploading' || item.status === 'queued') && (
                  <button
                    onClick={() => cancelUpload(item.id)}
                    className="p-1 text-slate-400 hover:text-red-400"
                    aria-label={t('Cancel upload of {name}', { name: item.name })}
                  >
                    <X className="w-4 h-4" aria-hidden />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
