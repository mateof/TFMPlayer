/** ReplayGain of a track as read from its tags. */
export interface ReplayGainInfo {
  db: number;
  /** Linear peak (1 = full scale), when tagged. */
  peak?: number;
}

/** Most a quiet track is raised (more risks noise and clipping). */
const MAX_BOOST_DB = 6;

/**
 * Volume factor for a track's ReplayGain. Without Web Audio the element's
 * volume cannot go above 1, so loud tracks are only turned down; with Web
 * Audio (`canBoost`) quiet tracks are raised too, never so much that the
 * tagged peak would clip.
 */
export function replayGainFactor(info: ReplayGainInfo | undefined, canBoost: boolean): number {
  if (!info || !Number.isFinite(info.db)) return 1;
  const db = Math.min(info.db, MAX_BOOST_DB);
  let factor = Math.pow(10, db / 20);
  if (info.peak && info.peak > 0) factor = Math.min(factor, 1 / info.peak);
  if (!canBoost) factor = Math.min(factor, 1);
  return Math.max(0.05, factor);
}
