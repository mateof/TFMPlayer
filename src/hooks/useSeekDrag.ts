import { useCallback, useEffect, useRef, useState } from 'react';

const RELEASE_EVENTS = ['pointerup', 'pointercancel', 'touchend', 'touchcancel'] as const;

/**
 * Seek bar that only seeks when the finger (or mouse) is lifted. While
 * dragging, the bar and the time show where it would land, but the audio
 * keeps playing where it was: seeking on every `change` restarted the stream
 * dozens of times per drag. Keyboard and plain clicks still seek at once.
 *
 * After the release the target stays on screen (up to a second) until playback
 * reports a position near it, so the thumb doesn't jump back for a moment.
 */
export function useSeekDrag(position: number, seek: (seconds: number) => void) {
  // Drag target, and whether the finger is still down (else: just released)
  const [shown, setShown] = useState<{ value: number; dragging: boolean } | null>(null);
  const dragging = useRef(false);
  const target = useRef<number | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const detach = useRef<(() => void) | null>(null);
  const seekRef = useRef(seek);

  useEffect(() => {
    seekRef.current = seek;
  }, [seek]);

  const start = useCallback(() => {
    if (dragging.current) return;
    dragging.current = true;
    target.current = null;
    clearTimeout(settleTimer.current);

    const release = () => {
      detach.current?.();
      detach.current = null;
      dragging.current = false;
      const value = target.current;
      if (value === null) {
        setShown(null);
        return;
      }
      seekRef.current(value);
      setShown({ value, dragging: false });
      settleTimer.current = setTimeout(() => {
        target.current = null;
        setShown(null);
      }, 1000);
    };
    // The release can happen outside the input (finger slid off the bar)
    RELEASE_EVENTS.forEach((name) => window.addEventListener(name, release));
    detach.current = () => RELEASE_EVENTS.forEach((name) => window.removeEventListener(name, release));
  }, []);

  useEffect(() => () => {
    clearTimeout(settleTimer.current);
    detach.current?.();
  }, []);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = parseFloat(e.target.value);
    if (!Number.isFinite(value)) return;
    if (dragging.current) {
      target.current = value;
      setShown({ value, dragging: true });
    } else {
      seekRef.current(value);
    }
  }, []);

  // Once released, playback reaching the target shows the real position again
  const value = shown && (shown.dragging || Math.abs(position - shown.value) > 1.5) ? shown.value : position;
  return {
    /** Position to draw (the drag target while dragging). */
    value,
    inputProps: {
      value,
      onChange,
      onPointerDown: start,
      onTouchStart: start
    }
  };
}
