import { useEffect } from 'react';
import { audioPlayer } from '@/services/audio/AudioPlayerService';
import { usePlayerStore } from '@/stores/playerStore';
import { useUiStore } from '@/stores/uiStore';

const SEEK_STEP_SECONDS = 10;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    // Sliders and checkboxes do not take text: shortcuts still apply
    const type = (target as HTMLInputElement).type;
    return !['range', 'checkbox', 'radio', 'button'].includes(type);
  }
  return false;
}

/**
 * Global player shortcuts (desktop / hardware keyboard):
 * Space play-pause, ←/→ seek 10 s, Shift+←/→ previous/next track,
 * Escape closes the full player.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;

      const ui = useUiStore.getState();
      if (e.key === 'Escape' && ui.isPlayerExpanded) {
        ui.setPlayerExpanded(false);
        return;
      }

      const { currentTrack, position, duration } = usePlayerStore.getState();
      if (!currentTrack) return;

      switch (e.key) {
        case ' ':
          // A focused button would also "click" on Space: keep one action
          if (e.target instanceof HTMLButtonElement) return;
          e.preventDefault();
          void audioPlayer.togglePlayPause();
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) void audioPlayer.next();
          else audioPlayer.seek(Math.min(duration || Infinity, position + SEEK_STEP_SECONDS));
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) void audioPlayer.skipToPrevious();
          else audioPlayer.seek(Math.max(0, position - SEEK_STEP_SECONDS));
          break;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}
