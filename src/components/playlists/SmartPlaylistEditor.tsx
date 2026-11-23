import { useMemo, useState } from 'react';
import { Sparkles, X, HardDrive, Search, Check } from 'lucide-react';
import { useDialog } from '@/hooks/useDialog';
import { useChannelsQuery } from '@/hooks/queries';
import { ChannelAvatar } from '@/components/channels/ChannelAvatar';
import { AUDIO_EXTENSIONS } from '@/utils/channelTracks';
import { DEFAULT_SMART_RULES, type SmartRules, type SmartSort, type SmartSource } from '@/services/playlists/smartPlaylists';
import { t } from '@/i18n';

interface SmartPlaylistEditorProps {
  initial?: { name: string; rules: SmartRules };
  onSave: (name: string, rules: SmartRules) => Promise<void> | void;
  onClose: () => void;
}

const DAY_OPTIONS = [0, 7, 30, 90, 365];
const LIMIT_OPTIONS = [100, 250, 500, 1000, 2000];

const sourceKey = (s: SmartSource) => (s.kind === 'local' ? 'local' : `channel:${s.channelId}`);

/** Create or edit the rules of a smart playlist. */
export function SmartPlaylistEditor({ initial, onSave, onClose }: SmartPlaylistEditorProps) {
  const dialogProps = useDialog(onClose, 'smart-editor-title');
  const channels = useChannelsQuery().data ?? [];
  const [name, setName] = useState(initial?.name ?? '');
  const [rules, setRules] = useState<SmartRules>(initial?.rules ?? DEFAULT_SMART_RULES);
  const [channelFilter, setChannelFilter] = useState('');
  const [saving, setSaving] = useState(false);

  const selected = useMemo(() => new Set(rules.sources.map(sourceKey)), [rules.sources]);
  const visibleChannels = channels
    .filter((c) => c.name.toLowerCase().includes(channelFilter.toLowerCase()))
    .slice(0, 100);

  const toggleSource = (source: SmartSource) => {
    const key = sourceKey(source);
    setRules((r) => ({
      ...r,
      sources: selected.has(key) ? r.sources.filter((s) => sourceKey(s) !== key) : [...r.sources, source]
    }));
  };

  const toggleFormat = (ext: string) =>
    setRules((r) => ({
      ...r,
      formats: r.formats.includes(ext) ? r.formats.filter((f) => f !== ext) : [...r.formats, ext]
    }));

  const canSave = name.trim().length > 0 && rules.sources.length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave(name.trim(), rules);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const chip = (active: boolean) =>
    `px-3 py-1 text-sm rounded-full transition-colors ${active ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        {...dialogProps}
        className="relative w-full max-w-lg max-h-[90vh] flex flex-col bg-slate-800 rounded-t-2xl sm:rounded-2xl overflow-hidden outline-none safe-area-bottom"
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-700">
          <Sparkles className="w-5 h-5 text-amber-300" aria-hidden />
          <h2 id="smart-editor-title" className="flex-1 text-white font-semibold">
            {initial ? t('Edit smart playlist') : t('New smart playlist')}
          </h2>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-white" aria-label={t('Close')}>
            <X className="w-5 h-5" aria-hidden />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          <label className="block">
            <span className="text-xs text-slate-400 uppercase tracking-wide">{t('Name')}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('e.g. FLAC added this month')}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-emerald-400"
              autoFocus
            />
          </label>

          <fieldset>
            <legend className="text-xs text-slate-400 uppercase tracking-wide">{t('Sources')}</legend>
            <p className="text-xs text-slate-500 mb-2">{t('Whole channels (every folder) and/or the server local files.')}</p>
            <button
              onClick={() => toggleSource({ kind: 'local' })}
              aria-pressed={selected.has('local')}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg mb-2 ${selected.has('local') ? 'bg-emerald-500/15 ring-1 ring-emerald-500' : 'bg-slate-900 hover:bg-slate-700'}`}
            >
              <HardDrive className="w-5 h-5 text-slate-300" aria-hidden />
              <span className="flex-1 text-left text-sm text-white">{t('Local files')}</span>
              {selected.has('local') && <Check className="w-4 h-4 text-emerald-400" aria-hidden />}
            </button>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 mb-2">
              <Search className="w-4 h-4 text-slate-500" aria-hidden />
              <input
                value={channelFilter}
                onChange={(e) => setChannelFilter(e.target.value)}
                placeholder={t('Filter channels...')}
                aria-label={t('Filter channels...')}
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 outline-none"
              />
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1 pr-1">
              {visibleChannels.map((c) => {
                const source: SmartSource = { kind: 'channel', channelId: String(c.id), channelName: c.name };
                const on = selected.has(sourceKey(source));
                return (
                  <button
                    key={c.id}
                    onClick={() => toggleSource(source)}
                    aria-pressed={on}
                    className={`w-full flex items-center gap-3 px-3 py-1.5 rounded-lg ${on ? 'bg-emerald-500/15 ring-1 ring-emerald-500' : 'hover:bg-slate-700'}`}
                  >
                    <ChannelAvatar channelId={c.id} name={c.name} size="sm" />
                    <span className="flex-1 text-left text-sm text-white truncate">{c.name}</span>
                    {on && <Check className="w-4 h-4 text-emerald-400" aria-hidden />}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs text-slate-400 uppercase tracking-wide mb-2">{t('Formats')}</legend>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setRules((r) => ({ ...r, formats: [] }))} aria-pressed={rules.formats.length === 0} className={chip(rules.formats.length === 0)}>
                {t('Any')}
              </button>
              {AUDIO_EXTENSIONS.map((ext) => (
                <button key={ext} onClick={() => toggleFormat(ext)} aria-pressed={rules.formats.includes(ext)} className={chip(rules.formats.includes(ext))}>
                  {ext.toUpperCase()}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="text-xs text-slate-400 uppercase tracking-wide">{t('Name or folder contains')}</span>
            <input
              value={rules.nameContains}
              onChange={(e) => setRules((r) => ({ ...r, nameContains: e.target.value }))}
              placeholder={t('Optional')}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </label>

          <fieldset>
            <legend className="text-xs text-slate-400 uppercase tracking-wide mb-2">{t('Added')}</legend>
            <div className="flex flex-wrap gap-2">
              {DAY_OPTIONS.map((d) => (
                <button key={d} onClick={() => setRules((r) => ({ ...r, addedWithinDays: d }))} aria-pressed={rules.addedWithinDays === d} className={chip(rules.addedWithinDays === d)}>
                  {d === 0 ? t('Any time') : t('Last {count} days', { count: d })}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs text-slate-400 uppercase tracking-wide">{t('Order')}</span>
              <select
                value={rules.sort}
                onChange={(e) => setRules((r) => ({ ...r, sort: e.target.value as SmartSort }))}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 text-white outline-none focus:ring-2 focus:ring-emerald-400"
              >
                <option value="name">{t('Name')}</option>
                <option value="newest">{t('Newest first')}</option>
                <option value="oldest">{t('Oldest first')}</option>
                <option value="random">{t('Random')}</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs text-slate-400 uppercase tracking-wide">{t('Maximum')}</span>
              <select
                value={rules.limit}
                onChange={(e) => setRules((r) => ({ ...r, limit: Number(e.target.value) }))}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-slate-900 text-white outline-none focus:ring-2 focus:ring-emerald-400"
              >
                {LIMIT_OPTIONS.map((n) => (
                  <option key={n} value={n}>{t('{count} tracks', { count: n })}</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="flex gap-2 p-4 border-t border-slate-700">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-lg bg-slate-700 text-slate-200 text-sm font-medium hover:bg-slate-600">
            {t('Cancel')}
          </button>
          <button
            onClick={save}
            disabled={!canSave}
            className="flex-1 py-2.5 rounded-lg bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-50"
          >
            {t('Save')}
          </button>
        </div>
      </div>
    </div>
  );
}
