import { useState } from 'react';
import { RefreshCw, X, Music, Film, FileText, Image, Loader2, AlertTriangle } from 'lucide-react';
import { channelRefreshService, loadRefreshOptions } from '@/services/channelRefresh/ChannelRefreshService';
import { useUiStore } from '@/stores/uiStore';
import { useDialog } from '@/hooks/useDialog';
import type { ChannelRefreshOptions, ChannelStats } from '@/types/models';
import { t } from '@/i18n';

interface RefreshChannelDialogProps {
  channelId: string;
  channelName: string;
  stats: ChannelStats | null;
  onClose: () => void;
}

type OptionalKind = 'includeVideo' | 'includeDocuments' | 'includePhotos';

export function RefreshChannelDialog({ channelId, channelName, stats, onClose }: RefreshChannelDialogProps) {
  const addToast = useUiStore((s) => s.addToast);
  const [options, setOptions] = useState<ChannelRefreshOptions>(loadRefreshOptions);
  const [submitting, setSubmitting] = useState(false);
  const dialogProps = useDialog(onClose, 'refresh-channel-title');

  const blocked = stats?.canRefresh === false;

  const kinds: { key: OptionalKind; label: string; icon: React.ReactNode; count?: number }[] = [
    { key: 'includeVideo', label: t('Videos'), icon: <Film className="w-5 h-5" />, count: stats?.videoCount },
    { key: 'includeDocuments', label: t('Documents'), icon: <FileText className="w-5 h-5" />, count: stats?.documentCount },
    { key: 'includePhotos', label: t('Photos'), icon: <Image className="w-5 h-5" />, count: stats?.photoCount }
  ];

  const toggle = (key: keyof ChannelRefreshOptions) =>
    setOptions((o) => ({ ...o, [key]: !o[key] }));

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await channelRefreshService.start(channelId, channelName, options);
      addToast(t('Channel refresh started'), 'info');
      onClose();
    } catch (error) {
      console.error('Channel refresh failed to start:', error);
      const status = (error as { response?: { status?: number } }).response?.status;
      addToast(
        status === 404
          ? t('This server does not support refreshing channels (update TelegramFileManager)')
          : t('Could not start the refresh'),
        'error'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div {...dialogProps} className="relative w-full max-w-md bg-slate-800 rounded-t-2xl sm:rounded-2xl overflow-hidden safe-area-bottom outline-none">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700">
          <RefreshCw className="w-5 h-5 text-emerald-400" />
          <div className="flex-1 min-w-0">
            <h2 id="refresh-channel-title" className="text-white font-semibold">{t('Refresh channel')}</h2>
            <p className="text-xs text-slate-400 truncate">{channelName}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white" aria-label={t('Close')}>
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-sm text-slate-300">
            {t('TelegramFileManager will scan the channel and index the files it does not know yet. It runs on the server and can take a few minutes on large channels.')}
          </p>

          {blocked && (
            <div className="flex gap-2 p-3 rounded-lg bg-amber-500/10 text-amber-300 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>
                {t('This is one of your own channels. Enable "refresh own channels" in the TelegramFileManager settings to scan it.')}
              </span>
            </div>
          )}

          <div className="space-y-2">
            <p className="text-xs text-slate-400 uppercase tracking-wide">{t('File types to fetch')}</p>

            {/* Audio is the reason this app exists: always refreshed */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-slate-700/40">
              <span className="text-emerald-400"><Music className="w-5 h-5" /></span>
              <span className="flex-1 text-sm text-white">{t('Audio')}</span>
              {stats && <span className="text-xs text-slate-400 tabular-nums">{t('{count} indexed', { count: stats.audioCount })}</span>}
              <span className="text-xs text-emerald-400">{t('Always')}</span>
            </div>

            {kinds.map((kind) => (
              <label
                key={kind.key}
                className="flex items-center gap-3 p-3 rounded-lg bg-slate-700/40 hover:bg-slate-700 cursor-pointer"
              >
                <span className={options[kind.key] ? 'text-emerald-400' : 'text-slate-400'}>{kind.icon}</span>
                <span className="flex-1 text-sm text-white">{kind.label}</span>
                {kind.count !== undefined && (
                  <span className="text-xs text-slate-400 tabular-nums">{t('{count} indexed', { count: kind.count })}</span>
                )}
                <input
                  type="checkbox"
                  checked={options[kind.key]}
                  onChange={() => toggle(kind.key)}
                  className="w-5 h-5 accent-emerald-500"
                />
              </label>
            ))}
          </div>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={options.force}
              onChange={() => toggle('force')}
              className="w-5 h-5 mt-0.5 accent-emerald-500"
            />
            <span className="text-sm">
              <span className="text-white">{t('Full rescan')}</span>
              <span className="block text-xs text-slate-400">
                {t('Walk the whole channel again even if a previous scan completed. Slower.')}
              </span>
            </span>
          </label>
        </div>

        <div className="flex gap-2 px-4 pb-4">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg bg-slate-700 text-slate-200 text-sm font-medium hover:bg-slate-600"
          >
            {t('Cancel')}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || blocked}
            className="flex-1 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {t('Refresh')}
          </button>
        </div>
      </div>
    </div>
  );
}
