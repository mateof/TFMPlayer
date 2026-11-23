import { Check, Palette, Sparkles, ImageIcon, Wind } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { ACCENTS, BACKGROUNDS } from '@/theme/themes';
import { t } from '@/i18n';

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

function EffectRow({ icon, title, description, on, onChange }: {
  icon: React.ReactNode; title: string; description: string; on: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 p-4 bg-slate-800 rounded-lg">
      <span className={on ? 'text-emerald-400' : 'text-slate-400'} aria-hidden>{icon}</span>
      <div className="flex-1">
        <p className="text-sm text-white">{title}</p>
        <p className="text-xs text-slate-400">{description}</p>
      </div>
      <Toggle on={on} onChange={onChange} label={title} />
    </div>
  );
}

/** Colour theme, background and visual effects. */
export function AppearanceSettings() {
  const { accent, background, dynamicColor, ambientBackground, reduceMotion, setAppearance } = useSettingsStore();

  return (
    <section className="p-4" aria-labelledby="appearance-heading">
      <h2 id="appearance-heading" className="text-sm font-medium text-slate-400 uppercase mb-4">{t('Appearance')}</h2>
      <div className="space-y-3">
        <div className="p-4 bg-slate-800 rounded-lg space-y-3">
          <div className="flex items-center gap-3">
            <Palette className="w-5 h-5 text-emerald-400" aria-hidden />
            <p className="text-sm text-white">{t('Accent colour')}</p>
          </div>
          <div role="radiogroup" aria-label={t('Accent colour')} className="flex flex-wrap gap-3">
            {ACCENTS.map((a) => {
              const selected = accent === a.id;
              return (
                <button
                  key={a.id}
                  role="radio"
                  aria-checked={selected}
                  aria-label={t(a.label)}
                  title={t(a.label)}
                  onClick={() => setAppearance({ accent: a.id })}
                  className={`w-10 h-10 rounded-full flex items-center justify-center ring-offset-2 ring-offset-slate-800 transition-transform hover:scale-110 ${selected ? 'ring-2 ring-white' : ''}`}
                  style={{ background: `linear-gradient(135deg, ${a.palette['400']}, ${a.palette['600']})` }}
                >
                  {selected && <Check className="w-5 h-5 text-white drop-shadow" aria-hidden />}
                </button>
              );
            })}
          </div>
          {dynamicColor && (
            <p className="text-xs text-slate-400">{t('While a track with a cover plays, its colour is used instead.')}</p>
          )}
        </div>

        <div className="p-4 bg-slate-800 rounded-lg space-y-3">
          <p className="text-sm text-white">{t('Background')}</p>
          <div role="radiogroup" aria-label={t('Background')} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {BACKGROUNDS.map((b) => {
              const selected = background === b.id;
              return (
                <button
                  key={b.id}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setAppearance({ background: b.id })}
                  className={`rounded-xl overflow-hidden text-left ring-2 transition-colors ${selected ? 'ring-emerald-500' : 'ring-transparent hover:ring-slate-600'}`}
                >
                  {/* Mini preview: page, card and accent */}
                  <div className="h-14 p-2 flex flex-col gap-1.5" style={{ background: b.palette['900'] }}>
                    <div className="h-2 w-2/3 rounded-full" style={{ background: b.palette['700'] }} />
                    <div className="flex-1 rounded-md flex items-center px-1.5" style={{ background: b.palette['800'] }}>
                      <div className="h-1.5 w-6 rounded-full bg-emerald-500" />
                    </div>
                  </div>
                  <div className="px-2 py-1.5 bg-slate-900 text-xs text-slate-200 flex items-center justify-between">
                    {t(b.label)}
                    {selected && <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <EffectRow
          icon={<Sparkles className="w-5 h-5" />}
          title={t('Colour from the cover')}
          description={t('The accent colour follows the artwork of the playing track')}
          on={dynamicColor}
          onChange={(v) => setAppearance({ dynamicColor: v })}
        />
        <EffectRow
          icon={<ImageIcon className="w-5 h-5" />}
          title={t('Ambient background')}
          description={t('Blurred artwork behind the player')}
          on={ambientBackground}
          onChange={(v) => setAppearance({ ambientBackground: v })}
        />
        <EffectRow
          icon={<Wind className="w-5 h-5" />}
          title={t('Reduce motion')}
          description={t('Turn off animations and transitions')}
          on={reduceMotion}
          onChange={(v) => setAppearance({ reduceMotion: v })}
        />
      </div>
    </section>
  );
}
