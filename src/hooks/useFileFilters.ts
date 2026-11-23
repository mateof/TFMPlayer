import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useDebounce } from '@/hooks/useDebounce';

export type FilterMode = 'audio_folders' | 'audio' | 'mp3' | 'flac' | 'wav' | 'ogg' | 'aac' | 'm4a' | 'wma' | 'ape' | 'opus';
export type SortBy = 'name' | 'date' | 'size' | 'type';

export const FILTER_OPTIONS: { key: FilterMode; label: string; group: 'general' | 'format' }[] = [
  { key: 'audio_folders', label: 'Audio + Folders', group: 'general' },
  { key: 'audio', label: 'All Audio', group: 'general' },
  { key: 'mp3', label: 'MP3', group: 'format' },
  { key: 'flac', label: 'FLAC', group: 'format' },
  { key: 'wav', label: 'WAV', group: 'format' },
  { key: 'ogg', label: 'OGG', group: 'format' },
  { key: 'opus', label: 'OPUS', group: 'format' },
  { key: 'aac', label: 'AAC', group: 'format' },
  { key: 'm4a', label: 'M4A', group: 'format' },
  { key: 'wma', label: 'WMA', group: 'format' },
  { key: 'ape', label: 'APE', group: 'format' }
];

export const SORT_OPTIONS: { key: SortBy; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'date', label: 'Date' },
  { key: 'size', label: 'Size' },
  { key: 'type', label: 'Type' }
];

const FILTER_KEYS = new Set<string>(FILTER_OPTIONS.map((o) => o.key));
const SORT_KEYS = new Set<string>(SORT_OPTIONS.map((o) => o.key));

/**
 * Filter, sort and search of a file list, kept in the URL so the back
 * button and shared links restore them. The URL is the only source of truth.
 */
export function useFileFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const rawFilter = searchParams.get('filter');
  const rawSort = searchParams.get('sortBy');
  const filterMode: FilterMode = rawFilter && FILTER_KEYS.has(rawFilter) ? (rawFilter as FilterMode) : 'audio_folders';
  const sortBy: SortBy = rawSort && SORT_KEYS.has(rawSort) ? (rawSort as SortBy) : 'name';
  const sortDesc = searchParams.get('sortDesc') === 'true';
  const searchText = searchParams.get('search') ?? '';
  const debouncedSearch = useDebounce(searchText, 700);

  const update = useCallback((key: string, value: string | null) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value === null) params.delete(key);
      else params.set(key, value);
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  /** Click on a sort chip: the same key flips direction, a new key sorts ascending. */
  const toggleSort = useCallback((sort: SortBy) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      const current = params.get('sortBy') ?? 'name';
      if (current === sort) {
        if (params.get('sortDesc') === 'true') params.delete('sortDesc');
        else params.set('sortDesc', 'true');
      } else {
        if (sort === 'name') params.delete('sortBy');
        else params.set('sortBy', sort);
        params.delete('sortDesc');
      }
      return params;
    }, { replace: true });
  }, [setSearchParams]);

  return {
    filterMode,
    sortBy,
    sortDesc,
    searchText,
    debouncedSearch,
    setFilterMode: (mode: FilterMode) => update('filter', mode === 'audio_folders' ? null : mode),
    setSearchText: (text: string) => update('search', text === '' ? null : text),
    toggleSort
  };
}

export type FileFilters = ReturnType<typeof useFileFilters>;
