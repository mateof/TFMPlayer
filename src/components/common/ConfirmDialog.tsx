import { AlertTriangle, HelpCircle } from 'lucide-react';
import { useDialog } from '@/hooks/useDialog';
import { t } from '@/i18n';
import { useConfirmStore, type PendingConfirm } from './confirm';

/** Mounted once in the app shell. */
export function ConfirmHost() {
  const pending = useConfirmStore((s) => s.pending);
  if (!pending) return null;
  return <ConfirmPanel key={pending.message} pending={pending} />;
}

function ConfirmPanel({ pending }: { pending: PendingConfirm }) {
  const close = (ok: boolean) => {
    useConfirmStore.setState({ pending: null });
    pending.resolve(ok);
  };
  const dialogProps = useDialog(() => close(false), 'confirm-dialog-title');
  const Icon = pending.danger ? AlertTriangle : HelpCircle;

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={() => close(false)} />
      <div
        {...dialogProps}
        aria-describedby="confirm-dialog-message"
        className="relative w-full max-w-sm bg-slate-800 rounded-t-2xl sm:rounded-2xl p-5 shadow-2xl outline-none safe-area-bottom"
      >
        <div className="flex gap-3">
          <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${pending.danger ? 'bg-red-500/15 text-red-400' : 'bg-emerald-500/15 text-emerald-400'}`}>
            <Icon className="w-5 h-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <h2 id="confirm-dialog-title" className="text-white font-semibold">
              {pending.title ?? t('Are you sure?')}
            </h2>
            <p id="confirm-dialog-message" className="mt-1 text-sm text-slate-300 break-words">
              {pending.message}
            </p>
          </div>
        </div>
        <div className="mt-5 flex gap-2 justify-end">
          <button
            onClick={() => close(false)}
            className="px-4 py-2 rounded-lg bg-slate-700 text-slate-200 text-sm font-medium hover:bg-slate-600"
          >
            {pending.cancelLabel ?? t('Cancel')}
          </button>
          <button
            onClick={() => close(true)}
            autoFocus
            className={`px-4 py-2 rounded-lg text-white text-sm font-medium ${pending.danger ? 'bg-red-500 hover:bg-red-600' : 'bg-emerald-500 hover:bg-emerald-600'}`}
          >
            {pending.confirmLabel ?? t('Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
