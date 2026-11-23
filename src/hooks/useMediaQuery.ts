import { useSyncExternalStore } from 'react';

/** Live result of a CSS media query (e.g. the desktop breakpoint). */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false
  );
}

// Keep in sync with Tailwind's lg / xl breakpoints
export const DESKTOP_QUERY = '(min-width: 1024px)';
export const WIDE_QUERY = '(min-width: 1280px)';
