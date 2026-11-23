/**
 * App logger. `debug`/`info` only print when debug logging is on (Settings →
 * Advanced, or `localStorage['tfm.debug'] = '1'`), so normal use keeps the
 * console quiet. Warnings and errors always print.
 */
const DEBUG_KEY = 'tfm.debug';

let enabled = readFlag();

function readFlag(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(DEBUG_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDebugLogging(on: boolean): void {
  enabled = on;
  try {
    if (on) localStorage.setItem(DEBUG_KEY, '1');
    else localStorage.removeItem(DEBUG_KEY);
  } catch {
    // Storage unavailable: the flag still applies to this session
  }
}

export function isDebugLogging(): boolean {
  return enabled;
}

export const log = {
  debug: (...args: unknown[]) => {
    if (enabled) console.debug('[TFM]', ...args);
  },
  info: (...args: unknown[]) => {
    if (enabled) console.info('[TFM]', ...args);
  },
  warn: (...args: unknown[]) => console.warn('[TFM]', ...args),
  error: (...args: unknown[]) => console.error('[TFM]', ...args)
};
