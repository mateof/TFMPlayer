// Tests assert on the English source strings (i18n keys)
localStorage.setItem('tfm.language', 'en');

// In-memory IndexedDB so Dexie works under jsdom
import 'fake-indexeddb/auto';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Vitest runs without globals, so Testing Library can't unmount on its own
afterEach(() => cleanup());

// jsdom has no matchMedia: behave like a phone-sized screen
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false
  });
}
