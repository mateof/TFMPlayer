import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useDialog } from '@/hooks/useDialog';
import { entryNameProblem } from '@/services/files/fileManager';
import { t } from '@/i18n';

interface NameDialogProps {
  title: string;
  initialName?: string;
  confirmLabel: string;
  onSubmit: (name: string) => Promise<void>;
  onClose: () => void;
}

/** Small modal asking for a name (new folder, rename). */
export function NameDialog({ title, initialName = '', confirmLabel, onSubmit, onClose }: NameDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogProps = useDialog(onClose, 'name-dialog-title');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = entryNameProblem(name);
    if (problem) {
      setError(t(problem));
      return;
    }
    setBusy(true);
    try {
      await onSubmit(name.trim());
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not complete the action'));
    } finally {
      setBusy(false);
    }
  };

  // Focus the field once the dialog has taken focus; on rename select the
  // name without its extension, like file managers do
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      if (initialName) {
        const dot = initialName.lastIndexOf('.');
        input.setSelectionRange(0, dot > 0 ? dot : initialName.length);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [initialName]);

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        {...dialogProps}
        className="relative w-full max-w-sm bg-slate-800 rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl outline-none safe-area-bottom"
      >
      <form onSubmit={submit}>
        <h2 id="name-dialog-title" className="text-white font-semibold mb-3">{title}</h2>
        <label className="block text-xs text-slate-400 mb-1" htmlFor="name-dialog-input">{t('Name')}</label>
        <input
          id="name-dialog-input"
          ref={inputRef}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError(null);
          }}
          aria-invalid={!!error}
          aria-describedby={error ? 'name-dialog-error' : undefined}
          className="w-full px-3 py-2 rounded-lg bg-slate-900 text-white border border-slate-600 focus:border-emerald-400 outline-none"
        />
        {error && <p id="name-dialog-error" role="alert" className="mt-2 text-sm text-red-400">{error}</p>}
        <div className="mt-5 flex gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-700 text-slate-200 text-sm font-medium hover:bg-slate-600">
            {t('Cancel')}
          </button>
          <button
            type="submit"
            disabled={busy}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium disabled:opacity-60"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
            {confirmLabel}
          </button>
        </div>
      </form>
      </div>
    </div>
  );
}
