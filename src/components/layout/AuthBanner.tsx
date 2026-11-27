import { KeyRound } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useConnectionStore } from '@/stores/connectionStore';
import { t } from '@/i18n';

/** Shown while the server rejects the saved API key (see connectionStore). */
export function AuthBanner() {
  const unauthorized = useConnectionStore((s) => s.unauthorized);
  const navigate = useNavigate();
  const location = useLocation();
  if (!unauthorized) return null;

  return (
    <div role="alert" className="flex items-center gap-3 px-4 py-2 bg-amber-500/15 border-b border-amber-500/30 text-amber-200 text-sm">
      <KeyRound className="w-4 h-4 shrink-0" aria-hidden />
      <span className="flex-1 min-w-0">{t('The server rejected the API key. It may have changed on the server.')}</span>
      {location.pathname !== '/settings' && (
        <button
          type="button"
          onClick={() => navigate('/settings')}
          className="shrink-0 px-3 py-1 rounded-md bg-amber-500/25 hover:bg-amber-500/35 text-amber-100 font-medium"
        >
          {t('Check connection')}
        </button>
      )}
    </div>
  );
}
