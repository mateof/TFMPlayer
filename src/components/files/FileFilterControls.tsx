import { FILTER_OPTIONS, SORT_OPTIONS, type FileFilters } from '@/hooks/useFileFilters';
import { t } from '@/i18n';

const chipClass = (active: boolean) =>
  `px-3 py-1 text-sm rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-emerald-400 ${
    active ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
  }`;

/** Filter / format / sort chips shared by the channel and local file browsers. */
export function FileFilterControls({ filters }: { filters: FileFilters }) {
  const { filterMode, sortBy, sortDesc, setFilterMode, toggleSort } = filters;

  const group = (name: 'general' | 'format', label: string) => (
    <div role="group" aria-label={label}>
      <p className="text-xs text-slate-400 mb-2">{label}</p>
      <div className="flex flex-wrap gap-2">
        {FILTER_OPTIONS.filter((opt) => opt.group === name).map((opt) => (
          <button
            key={opt.key}
            onClick={() => setFilterMode(opt.key)}
            aria-pressed={filterMode === opt.key}
            className={chipClass(filterMode === opt.key)}
          >
            {t(opt.label)}
          </button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      {group('general', t('Filter'))}
      {group('format', t('Audio Format'))}
      <div role="group" aria-label={t('Sort by')}>
        <p className="text-xs text-slate-400 mb-2">{t('Sort by')}</p>
        <div className="flex flex-wrap gap-2">
          {SORT_OPTIONS.map((opt) => {
            const active = sortBy === opt.key;
            return (
              <button
                key={opt.key}
                onClick={() => toggleSort(opt.key)}
                aria-pressed={active}
                aria-label={
                  active
                    ? t(sortDesc ? 'Sort by {field}, descending' : 'Sort by {field}, ascending', { field: t(opt.label) })
                    : t('Sort by {field}', { field: t(opt.label) })
                }
                className={chipClass(active)}
              >
                {t(opt.label)} {active && (sortDesc ? '↓' : '↑')}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
