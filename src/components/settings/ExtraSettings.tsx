import { Link } from 'react-router-dom';
import { Blend, Languages, HardDrive, Bug, ChevronRight, History } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { getLanguage, LANGUAGES, setLanguage, t, type Language } from '@/i18n';
import { setDebugLogging } from '@/utils/logger';

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`w-12 h-6 rounded-full transition-colors shrink-0 ${on ? 'bg-emerald-500' : 'bg-slate-600'}`}
    >
      <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
    </button>
  );
}

/** Transitions, language, storage and diagnostics settings. */
export function ExtraSettings() {
  const crossfadeSeconds = useSettingsStore((s) => s.crossfadeSeconds);
  const setCrossfadeSeconds = useSettingsStore((s) => s.setCrossfadeSeconds);
  const autoCleanDays = useSettingsStore((s) => s.autoCleanDays);
  const debugLogging = useSettingsStore((s) => s.debugLogging);
  const setDebug = useSettingsStore((s) => s.setDebugLogging);

  return (
    <>
      <section className="p-4" aria-labelledby="transitions-heading">
        <h2 id="transitions-heading" className="text-sm font-medium text-slate-400 uppercase mb-4">{t('Transitions')}</h2>
        <div className="p-4 bg-slate-800 rounded-lg space-y-3">
          <div className="flex items-center gap-3">
            <Blend className={`w-5 h-5 ${crossfadeSeconds > 0 ? 'text-emerald-400' : 'text-slate-400'}`} aria-hidden />
            <div className="flex-1">
              <p className="text-sm text-white">{t('Crossfade')}</p>
              <p className="text-xs text-slate-400">
                {crossfadeSeconds > 0
                  ? t('The next track fades in over the last {count} seconds', { count: crossfadeSeconds })
                  : t('Off: tracks follow each other without a gap')}
              </p>
            </div>
            <span className="text-sm text-white tabular-nums w-10 text-right">{crossfadeSeconds}s</span>
          </div>
          <input
            type="range"
            min={0}
            max={12}
            step={1}
            value={crossfadeSeconds}
            onChange={(e) => setCrossfadeSeconds(Number(e.target.value))}
            aria-label={t('Crossfade seconds')}
            className="w-full"
          />
        </div>
      </section>

      <div className="h-px bg-slate-700 mx-4" />

      <section className="p-4" aria-labelledby="library-heading">
        <h2 id="library-heading" className="text-sm font-medium text-slate-400 uppercase mb-4">{t('Library')}</h2>
        <div className="space-y-2">
          <Link to="/storage" className="flex items-center gap-3 p-4 bg-slate-800 rounded-lg hover:bg-slate-700">
            <HardDrive className="w-5 h-5 text-slate-400" aria-hidden />
            <div className="flex-1">
              <p className="text-sm text-white">{t('Storage')}</p>
              <p className="text-xs text-slate-400">
                {autoCleanDays > 0
                  ? t('Automatic clean-up: not played in {count} days', { count: autoCleanDays })
                  : t('Space used per channel, free up space')}
              </p>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-500" aria-hidden />
          </Link>
          <Link to="/history" className="flex items-center gap-3 p-4 bg-slate-800 rounded-lg hover:bg-slate-700">
            <History className="w-5 h-5 text-slate-400" aria-hidden />
            <div className="flex-1">
              <p className="text-sm text-white">{t('History')}</p>
              <p className="text-xs text-slate-400">{t('Recently played and most played')}</p>
            </div>
            <ChevronRight className="w-5 h-5 text-slate-500" aria-hidden />
          </Link>
        </div>
      </section>

      <div className="h-px bg-slate-700 mx-4" />

      <section className="p-4" aria-labelledby="language-heading">
        <h2 id="language-heading" className="text-sm font-medium text-slate-400 uppercase mb-4">{t('Language')}</h2>
        <div className="flex items-center gap-3 p-4 bg-slate-800 rounded-lg">
          <Languages className="w-5 h-5 text-slate-400" aria-hidden />
          <label htmlFor="language-select" className="flex-1 text-sm text-white">{t('App language')}</label>
          <select
            id="language-select"
            value={getLanguage()}
            onChange={(e) => setLanguage(e.target.value as Language)}
            className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm outline-none focus:ring-2 focus:ring-emerald-400"
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>
      </section>

      <div className="h-px bg-slate-700 mx-4" />

      <section className="p-4" aria-labelledby="advanced-heading">
        <h2 id="advanced-heading" className="text-sm font-medium text-slate-400 uppercase mb-4">{t('Advanced')}</h2>
        <div className="flex items-center gap-3 p-4 bg-slate-800 rounded-lg">
          <Bug className="w-5 h-5 text-slate-400" aria-hidden />
          <div className="flex-1">
            <p className="text-sm text-white">{t('Debug logging')}</p>
            <p className="text-xs text-slate-400">{t('Detailed console messages to diagnose playback problems')}</p>
          </div>
          <Toggle
            on={debugLogging}
            label={t('Debug logging')}
            onChange={(v) => {
              setDebug(v);
              setDebugLogging(v);
            }}
          />
        </div>
      </section>

      <div className="h-px bg-slate-700 mx-4" />
    </>
  );
}
