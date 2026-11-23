import { useEffect, useRef, useState } from 'react';
import { Moon } from 'lucide-react';
import { audioPlayer } from '@/services/audio/AudioPlayerService';
import { usePlayerStore } from '@/stores/playerStore';
import { t } from '@/i18n';

const MINUTE_OPTIONS = [15, 30, 45, 60, 90];

function useRemaining(endsAt: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt) return null;
  const seconds = Math.max(0, Math.round((endsAt - now) / 1000));
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Moon button with the sleep timer menu; shows the countdown while active. */
export function SleepTimerButton({ size = 'md', placement = 'down' }: { size?: 'md' | 'lg'; placement?: 'up' | 'down' }) {
  const endsAt = usePlayerStore((s) => s.sleepTimerEndsAt);
  const atEnd = usePlayerStore((s) => s.sleepAtEndOfTrack);
  const remaining = useRemaining(endsAt);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const active = !!endsAt || atEnd;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const choose = (value: number | 'track' | 'off') => {
    if (value === 'off') audioPlayer.cancelSleepTimer();
    else audioPlayer.setSleepTimer(value);
    setOpen(false);
  };

  const item = (label: string, value: number | 'track' | 'off', selected: boolean) => (
    <button
      key={label}
      role="menuitemradio"
      aria-checked={selected}
      onClick={() => choose(value)}
      className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-700 ${selected ? 'text-emerald-400' : 'text-slate-200'}`}
    >
      {label}
    </button>
  );

  return (
    <div ref={rootRef} className="relative" data-no-dismiss>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={active ? t('Sleep timer: {time}', { time: remaining ?? t('end of track') }) : t('Sleep timer')}
        title={t('Sleep timer')}
        className={`flex items-center gap-1 p-2 rounded-full transition-colors ${active ? 'text-amber-300' : 'text-slate-400 hover:text-white'}`}
      >
        <Moon className={size === 'lg' ? 'w-5 h-5' : 'w-5 h-5'} aria-hidden fill={active ? 'currentColor' : 'none'} />
        {active && <span className="text-xs tabular-nums">{remaining ?? t('End')}</span>}
      </button>
      {open && (
        <div role="menu" className={`absolute right-0 ${placement === 'up' ? 'bottom-full mb-2' : 'top-full mt-2'} z-[80] w-48 py-1 rounded-xl bg-slate-800 border border-slate-700 shadow-2xl`}>
          <p className="px-4 py-2 text-xs uppercase tracking-wide text-slate-500">{t('Stop playing in')}</p>
          {MINUTE_OPTIONS.map((m) => item(t('{count} minutes', { count: m }), m, false))}
          {item(t('End of this track'), 'track', atEnd)}
          {active && item(t('Turn off'), 'off', false)}
        </div>
      )}
    </div>
  );
}
