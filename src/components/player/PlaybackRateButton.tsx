import { useSettingsStore } from '@/stores/settingsStore';
import { t } from '@/i18n';

const RATES = [1, 1.25, 1.5, 1.75, 2, 0.75];

/** Cycles the playback speed (1× → 1.25× → … → 0.75× → 1×). */
export function PlaybackRateButton({ size = 'md' }: { size?: 'md' | 'lg' }) {
  const rate = useSettingsStore((s) => s.playbackRate);
  const setPlayback = useSettingsStore((s) => s.setPlayback);
  const next = () => {
    const i = RATES.indexOf(rate);
    setPlayback({ playbackRate: RATES[(i + 1) % RATES.length] ?? 1 });
  };
  const label = `${rate}×`;
  return (
    <button
      type="button"
      onClick={next}
      aria-label={t('Playback speed: {rate}', { rate: label })}
      title={t('Playback speed: {rate}', { rate: label })}
      className={`${size === 'lg' ? 'min-w-11 h-11 text-sm' : 'min-w-9 h-9 text-xs'} px-1.5 rounded-full font-semibold tabular-nums transition-colors ${
        rate !== 1 ? 'text-emerald-400 bg-emerald-500/10' : 'text-slate-400 hover:text-white'
      }`}
    >
      {label}
    </button>
  );
}
