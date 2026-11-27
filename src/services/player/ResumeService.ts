import { getApiCache, setApiCache } from '@/db/database';
import { getV1Api } from '@/services/api/v1';
import { useSettingsStore } from '@/stores/settingsStore';
import type { Track } from '@/types/models';
import { log } from '@/utils/logger';
import { playerSyncEnabled, toApiTrack, trackKey } from './playerTrack';

/** Audio this long (podcasts, audiobooks, mixes) starts where it was left. */
export const LONG_TRACK_SECONDS = 20 * 60;
const LOCAL_KEY = 'resume-points';
const MAX_POINTS = 300;
const LOCAL_SAVE_MS = 10_000;
const SERVER_SAVE_MS = 30_000;

export interface ResumePoint {
  position: number;
  duration: number;
  updatedAt: number;
}

/** In the last 2% (or the last 15 s) a track counts as finished: no resume point. */
export function isFinished(position: number, duration: number): boolean {
  return duration > 0 && position >= duration - Math.max(15, duration * 0.02);
}

/**
 * "Continue where I left off" for long audio. Points live on the device and,
 * with `player.sync`, on the server too, so another device (or the web app)
 * picks up at the same second. The newest point wins.
 */
class ResumeService {
  private points = new Map<string, ResumePoint>();
  private loaded: Promise<void> | null = null;
  private lastLocalSave = 0;
  private lastServerSave = new Map<string, number>();

  /** Reads the saved points (device, then server). Safe to call repeatedly. */
  load(): Promise<void> {
    this.loaded ??= (async () => {
      const saved = await getApiCache<Record<string, ResumePoint>>(LOCAL_KEY).catch(() => undefined);
      for (const [key, point] of Object.entries(saved ?? {})) this.points.set(key, point);
      await this.syncFromServer();
    })();
    return this.loaded;
  }

  /** Merges the server's points (newest wins). */
  async syncFromServer(): Promise<void> {
    try {
      if (!(await playerSyncEnabled())) return;
      const list = await (await getV1Api()).player.resumeList(100);
      let changed = false;
      for (const item of list ?? []) {
        const key = item.track.key;
        if (!key) continue;
        const updatedAt = Date.parse(item.updatedAt) || 0;
        const mine = this.points.get(key);
        if (!mine || mine.updatedAt < updatedAt) {
          this.points.set(key, { position: item.positionSeconds, duration: item.durationSeconds, updatedAt });
          changed = true;
        }
      }
      if (changed) this.saveLocal(true);
    } catch (error) {
      log.warn('Could not read the resume points of the server:', error);
    }
  }

  /** Where to start this track, or null (short track, finished, setting off). */
  positionFor(track: Track): number | null {
    if (!useSettingsStore.getState().resumeLongTracks) return null;
    const point = this.points.get(trackKey(track));
    if (!point || point.duration < LONG_TRACK_SECONDS || point.position < 5) return null;
    if (isFinished(point.position, point.duration)) return null;
    return point.position;
  }

  /** Playback progress of the current track (timeupdate, pause, end). */
  report(track: Track | null, position: number, duration: number, flush = false): void {
    if (!track || !useSettingsStore.getState().resumeLongTracks) return;
    if (!Number.isFinite(duration) || duration < LONG_TRACK_SECONDS || !Number.isFinite(position)) return;
    const key = trackKey(track);

    if (isFinished(position, duration)) {
      if (this.points.delete(key)) {
        this.saveLocal(true);
        void this.removeOnServer(key);
      }
      return;
    }
    if (position < 5) return;

    this.points.set(key, { position, duration, updatedAt: Date.now() });
    this.saveLocal(flush);
    const last = this.lastServerSave.get(key) ?? 0;
    if (flush || Date.now() - last >= SERVER_SAVE_MS) {
      this.lastServerSave.set(key, Date.now());
      void this.saveOnServer(track, position, duration);
    }
  }

  forget(track: Track): void {
    const key = trackKey(track);
    if (this.points.delete(key)) {
      this.saveLocal(true);
      void this.removeOnServer(key);
    }
  }

  private saveLocal(force: boolean): void {
    if (!force && Date.now() - this.lastLocalSave < LOCAL_SAVE_MS) return;
    this.lastLocalSave = Date.now();
    // Bounded: the most recent points only
    const entries = [...this.points.entries()].sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_POINTS);
    this.points = new Map(entries);
    setApiCache(LOCAL_KEY, Object.fromEntries(entries)).catch(() => {});
  }

  private async saveOnServer(track: Track, position: number, duration: number): Promise<void> {
    try {
      if (!(await playerSyncEnabled())) return;
      await (await getV1Api()).player.saveResume({ track: toApiTrack(track), positionSeconds: position, durationSeconds: duration });
    } catch (error) {
      log.warn('Could not save the resume point on the server:', error);
    }
  }

  private async removeOnServer(key: string): Promise<void> {
    try {
      if (!(await playerSyncEnabled())) return;
      await (await getV1Api()).player.removeResume(key);
    } catch {
      // the server drops finished points by itself too
    }
  }

  /** Test helper. */
  __reset(): void {
    this.points.clear();
    this.loaded = null;
    this.lastLocalSave = 0;
    this.lastServerSave.clear();
  }
}

export const resumeService = new ResumeService();
