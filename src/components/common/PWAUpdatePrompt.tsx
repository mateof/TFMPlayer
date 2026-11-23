import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';
import { log } from '@/utils/logger';
import { t } from '@/i18n';

export function PWAUpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(swUrl, r) {
      // Check for updates every 30 seconds
      if (r) {
        setInterval(() => {
          r.update();
        }, 30 * 1000);
      }
      log.debug('SW registered:', swUrl);
    },
    onRegisterError(error) {
      console.error('SW registration error:', error);
    },
  });

  const handleUpdate = () => {
    updateServiceWorker(true);
  };

  const handleDismiss = () => {
    setNeedRefresh(false);
  };

  if (!needRefresh) return null;

  return (
    <div className="fixed top-4 left-4 right-4 z-[100] animate-in slide-in-from-top-2 fade-in duration-300">
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border bg-emerald-900/95 border-emerald-600 backdrop-blur-sm shadow-lg">
        <RefreshCw className="w-5 h-5 text-emerald-400 flex-shrink-0" />
        <p className="flex-1 text-sm text-white">
          {t('New version available')}
        </p>
        <button
          onClick={handleUpdate}
          className="px-3 py-1.5 text-sm font-medium bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg transition-colors"
        >
          {t('Update')}
        </button>
        <button
          onClick={handleDismiss}
          className="p-1 text-slate-400 hover:text-white transition-colors"
          title={t('Dismiss')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
