import { useCallback, useEffect, useRef } from 'react';

const MOVE_TOLERANCE_PX = 10;

/**
 * Long press (touch or mouse) on list rows. `bind(item)` returns the row
 * handlers; `consumeLongPress()` tells the click handler that the press it
 * is seeing already acted as a long press and must be ignored.
 */
export function useLongPress<T>(onLongPress: (item: T) => void, { enabled = true, delay = 500 } = {}) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggeredRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  const cancel = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    startRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const start = useCallback((item: T, x: number, y: number) => {
    if (!enabled) return;
    triggeredRef.current = false;
    startRef.current = { x, y };
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      triggeredRef.current = true;
      onLongPress(item);
    }, delay);
  }, [enabled, delay, onLongPress]);

  const move = useCallback((x: number, y: number) => {
    const origin = startRef.current;
    if (!origin || !timerRef.current) return;
    if (Math.abs(x - origin.x) > MOVE_TOLERANCE_PX || Math.abs(y - origin.y) > MOVE_TOLERANCE_PX) {
      cancel();
    }
  }, [cancel]);

  const bind = useCallback((item: T) => ({
    onTouchStart: (e: React.TouchEvent) => start(item, e.touches[0].clientX, e.touches[0].clientY),
    onTouchMove: (e: React.TouchEvent) => move(e.touches[0].clientX, e.touches[0].clientY),
    onTouchEnd: cancel,
    onTouchCancel: cancel,
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button === 0) start(item, e.clientX, e.clientY);
    },
    onMouseMove: (e: React.MouseEvent) => move(e.clientX, e.clientY),
    onMouseUp: cancel,
    onMouseLeave: cancel,
    // Starting a drag (desktop drag and drop) is not a long press
    onDragStart: cancel
  }), [start, move, cancel]);

  const consumeLongPress = useCallback(() => {
    if (triggeredRef.current) {
      triggeredRef.current = false;
      return true;
    }
    return false;
  }, []);

  return { bind, consumeLongPress };
}
