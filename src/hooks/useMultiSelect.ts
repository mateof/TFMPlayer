import { useCallback, useState } from 'react';

// Selection state for list screens: a long press enters selection mode with
// the pressed item selected, and taps toggle items until the mode is exited.
export function useMultiSelect<T>(getKey: (item: T) => string) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const isSelected = useCallback(
    (item: T) => selectedKeys.has(getKey(item)),
    [selectedKeys, getKey]
  );

  const toggle = useCallback((item: T) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      const key = getKey(item);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, [getKey]);

  const startWith = useCallback((item: T) => {
    setSelectionMode(true);
    setSelectedKeys(new Set([getKey(item)]));
  }, [getKey]);

  const selectAll = useCallback((items: T[]) => {
    setSelectedKeys(new Set(items.map(getKey)));
  }, [getKey]);

  const deselectAll = useCallback(() => setSelectedKeys(new Set()), []);

  const exitSelection = useCallback(() => {
    setSelectionMode(false);
    setSelectedKeys(new Set());
  }, []);

  return {
    selectionMode,
    selectedKeys,
    selectedCount: selectedKeys.size,
    isSelected,
    toggle,
    startWith,
    selectAll,
    deselectAll,
    exitSelection
  };
}
