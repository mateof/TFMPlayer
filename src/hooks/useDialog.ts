import { useEffect, useRef } from 'react';

/**
 * Modal dialog behaviour: Escape closes it, focus moves into it when it opens
 * and goes back to whatever had it when it closes. Spread `dialogProps` on
 * the dialog panel.
 */
export function useDialog(onClose: () => void, labelId: string) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Keep Escape from also closing the player overlay underneath
        e.stopImmediatePropagation();
        onCloseRef.current();
      }
    };
    // Capture phase: runs before the global player shortcuts
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, []);

  return {
    ref: panelRef,
    role: 'dialog' as const,
    'aria-modal': true,
    'aria-labelledby': labelId,
    tabIndex: -1
  };
}
