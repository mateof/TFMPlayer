import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MANAGE_FILTERS, type ManageFilter } from '@/services/files/fileManager';

export type ViewMode = 'list' | 'grid';

const VIEW_KEY = 'tfm.fileView';
const FILTER_SET = new Set<string>(MANAGE_FILTERS);

function readView(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'list';
  } catch {
    return 'list';
  }
}

/**
 * Manage mode on/off and its type filter live in the URL (back button and
 * reloads keep them); the list/grid choice is a per-device preference.
 */
export function useManageMode(forced = false) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [viewMode, setViewModeState] = useState<ViewMode>(readView);

  const manage = forced || searchParams.get('manage') === '1';
  const rawType = searchParams.get('type');
  const typeFilter: ManageFilter = rawType && FILTER_SET.has(rawType) ? (rawType as ManageFilter) : 'all';

  const update = useCallback((key: string, value: string | null) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value === null) params.delete(key);
      else params.set(key, value);
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    try {
      localStorage.setItem(VIEW_KEY, mode);
    } catch {
      // storage unavailable: keep it for this session
    }
  }, []);

  return {
    manage,
    setManage: (on: boolean) => update('manage', on ? '1' : null),
    typeFilter,
    setTypeFilter: (filter: ManageFilter) => update('type', filter === 'all' ? null : filter),
    viewMode: manage ? viewMode : 'list',
    setViewMode
  };
}

export type ManageModeState = ReturnType<typeof useManageMode>;
