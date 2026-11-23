import { create } from 'zustand';
import type { ChannelFile } from '@/types/models';

export type ClipboardMode = 'cut' | 'copy';

export interface FileClipboard {
  mode: ClipboardMode;
  /** Target key (`channel:123`, `local`): paste only works inside the same one. */
  targetKey: string;
  /** Folder the entries were taken from (pasting a cut there is a no-op). */
  fromLocation: string;
  files: ChannelFile[];
}

interface ClipboardState {
  clip: FileClipboard | null;
  set: (clip: FileClipboard) => void;
  clear: () => void;
}

/**
 * Cut/copy/paste of the file browser. Lives outside the screen so the user
 * can cut in one folder, navigate, and paste somewhere else.
 */
export const useFileClipboard = create<ClipboardState>((set) => ({
  clip: null,
  set: (clip) => set({ clip }),
  clear: () => set({ clip: null })
}));

/** Whether the clipboard can be pasted into `location` of `targetKey`. */
export function canPaste(clip: FileClipboard | null, targetKey: string, location: string): boolean {
  if (!clip || clip.targetKey !== targetKey || clip.files.length === 0) return false;
  // Moving into the folder the entries already are in does nothing
  if (clip.mode === 'cut' && clip.fromLocation === location) return false;
  // A folder can't go into itself
  return !clip.files.some((f) => f.category === 'Folder' && (f.id === location || f.path === location));
}
