import { create } from 'zustand';

export interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
}

export interface PendingConfirm extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

export const useConfirmStore = create<{ pending: PendingConfirm | null }>(() => ({ pending: null }));

/**
 * In-app replacement for window.confirm(): styled like the rest of the app,
 * accessible, and it doesn't block the page (a native confirm freezes the
 * player UI and every timer while it is open).
 */
export function confirmDialog(options: ConfirmOptions | string): Promise<boolean> {
  const opts = typeof options === 'string' ? { message: options } : options;
  return new Promise((resolve) => {
    // A second request while one is open answers the first with "cancel"
    useConfirmStore.getState().pending?.resolve(false);
    useConfirmStore.setState({ pending: { ...opts, resolve } });
  });
}

