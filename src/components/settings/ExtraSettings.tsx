import { Link } from 'react-router-dom';
import { Blend, Languages, HardDrive, Bug, ChevronRight, History, Bell, Bookmark, Gauge, Heart, Volume1 } from 'lucide-react';
import { useServerFeatures } from '@/hooks/useServerFeatures';
import { useSettingsStore } from '@/stores/settingsStore';
import { AppearanceSettings } from './AppearanceSettings';
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
      <div className={`w-5 h-5 bg-[#fff] rounded-full shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-0.5'}`} />
    </button>
  );
}

function SettingRow({ icon, title, text, children }: { icon: React.ReactNode; title: string; text: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 p-4 bg-slate-800 rounded-lg">
      {icon}
      <div className="flex-1 min-w-0">
        <p className="text-sm text-white">{title}</p>
        <p className="text-xs text-slate-400">{text}</p>
      </div>
      {children}
    </div>
  );
}

const RATES = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** Speed, resume points, volume levelling and what is shared with the server. */
function PlaybackSettings() {
  const playbackRate = useSettingsStore((s) => s.playbackRate);
  const resumeLongTracks = useSettingsStore((s) => s.resumeLongTracks);
  const replayGain = useSettingsStore((s) => s.replayGain);
  const serverNotifications = useSettingsStore((s) => s.serverNotifications);
  const syncPlayerData = useSettingsStore((s) => s.syncPlayerData);
  const setPlayback = useSettingsStore((s) => s.setPlayback);
  const { features } = useServerFeatures();
  const iconClass = (on: boolean) => `w-5 h-5 shrink-0 ${on ? 'text-emerald-400' : 'text-slate-400'}`;

  return (
    <section className="p-4" aria-labelledby="playback-heading">
      <h2 id="playback-heading" className="text-sm font-medium text-slate-400 uppercase mb-4">{t('Playback')}</h2>
      <div className="space-y-2">
        <SettingRow icon={<Gauge className={iconClass(playbackRate !== 1)} aria-hidden />} title={t('Playback speed')} text={t('For podcasts and audiobooks. Also in the full player.')}>
          <select
            value={String(playbackRate)}
            onChange={(e) => setPlayback({ playbackRate: Number(e.target.value) })}
            aria-label={t('Playback speed')}
            className="px-3 py-1.5 rounded-lg bg-slate-700 text-white text-sm outline-none focus:ring-2 focus:ring-emerald-400"
          >
            {RATES.map((r) => <option key={r} value={r}>{`${r}×`}</option>)}
          </select>
        </SettingRow>
        <SettingRow icon={<Bookmark className={iconClass(resumeLongTracks)} aria-hidden />} title={t('Resume long audio')} text={t('Tracks over 20 minutes start where you left them')}>
          <Toggle on={resumeLongTracks} label={t('Resume long audio')} onChange={(v) => setPlayback({ resumeLongTracks: v })} />
        </SettingRow>
        <SettingRow icon={<Volume1 className={iconClass(replayGain)} aria-hidden />} title={t('Volume levelling (ReplayGain)')} text={t('Tracks with ReplayGain tags play at the same loudness')}>
          <Toggle on={replayGain} label={t('Volume levelling (ReplayGain)')} onChange={(v) => setPlayback({ replayGain: v })} />
        </SettingRow>
        <SettingRow
          icon={<Heart className={iconClass(syncPlayerData && features.has('player.sync'))} aria-hidden />}
          title={t('Share favourites and history with the server')}
          text={features.has('player.sync')
            ? t('Favourite tracks, history and resume points are the same in the web and on every device')
            : t('Needs a newer TelegramFileManager. Until then they stay on this device.')}
        >
          <Toggle on={syncPlayerData} label={t('Share favourites and history with the server')} onChange={(v) => setPlayback({ syncPlayerData: v })} />
        </SettingRow>
        <SettingRow
          icon={<Bell className={iconClass(serverNotifications && features.has('events.hub'))} aria-hidden />}
          title={t('Server notifications')}
          text={features.has('events.hub')
            ? t('Downloads, uploads and errors reported by the server')
            : t('Needs a newer TelegramFileManager')}
        >
          <Toggle on={serverNotifications} label={t('Server notifications')} onChange={(v) => setPlayback({ serverNotifications: v })} />
        </SettingRow>
      </div>
    </section>
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
      <AppearanceSettings />

      <div className="h-px bg-slate-700 mx-4" />

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

      <PlaybackSettings />

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
