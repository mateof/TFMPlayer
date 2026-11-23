import { db, type PlayHistoryEntity } from '@/db/database';
import type { Track } from '@/types/models';

// A play counts once the track has sounded this long, or half of it if shorter
const COUNT_AFTER_SECONDS = 30;
const HISTORY_MAX_ENTRIES = 5000;

export interface HistoryItem {
  track: Track;
  playedAt: Date;
  plays: number;
}

/**
 * Listening history, kept on the device (playHistory table). The player
 * reports progress; one entry is written per play that lasted long enough.
 */
class PlayHistoryService {
  private current: { track: Track; listened: number; lastPos: number; recorded: boolean } | null = null;

  /** A new track started. */
  start(track: Track): void {
    this.current = { track, listened: 0, lastPos: -1, recorded: false };
  }

  /** Called on every timeupdate of the playing track. */
  tick(track: Track | null, position: number, duration: number, playing: boolean): void {
    const cur = this.current;
    if (!cur || !track || cur.track.fileId !== track.fileId || cur.recorded) return;
    if (playing && cur.lastPos >= 0) {
      const delta = position - cur.lastPos;
      // Ignore seeks and loop wraps: only small forward steps are listening
      if (delta > 0 && delta < 2) cur.listened += delta;
    }
    cur.lastPos = position;

    const threshold = Number.isFinite(duration) && duration > 0
      ? Math.min(COUNT_AFTER_SECONDS, duration / 2)
      : COUNT_AFTER_SECONDS;
    if (cur.listened >= threshold) {
      cur.recorded = true;
      this.record(cur.track).catch(() => {});
    }
  }

  private async record(track: Track): Promise<void> {
    await db.playHistory.add({
      trackId: track.fileId,
      channelId: track.channelId,
      fileName: track.fileName,
      playedAt: new Date(),
      trackJson: JSON.stringify(track)
    });
    // Keep the table bounded
    const count = await db.playHistory.count();
    if (count > HISTORY_MAX_ENTRIES) {
      const excess = await db.playHistory.orderBy('playedAt').limit(count - HISTORY_MAX_ENTRIES).primaryKeys();
      await db.playHistory.bulkDelete(excess);
    }
  }

  private toItem(entry: PlayHistoryEntity, plays: number): HistoryItem | null {
    if (!entry.trackJson) return null;
    try {
      return { track: JSON.parse(entry.trackJson) as Track, playedAt: entry.playedAt, plays };
    } catch {
      return null;
    }
  }

  /** Most recent first, one row per track. */
  async recent(limit = 100): Promise<HistoryItem[]> {
    const seen = new Map<string, { entry: PlayHistoryEntity; plays: number }>();
    await db.playHistory.orderBy('playedAt').reverse().each((entry) => {
      const existing = seen.get(entry.trackId);
      if (existing) existing.plays++;
      else seen.set(entry.trackId, { entry, plays: 1 });
    });
    return [...seen.values()]
      .slice(0, limit)
      .map(({ entry, plays }) => this.toItem(entry, plays))
      .filter((i): i is HistoryItem => i !== null);
  }

  /** Most played tracks over the last `days` days. */
  async mostPlayed(days = 90, limit = 100): Promise<HistoryItem[]> {
    const since = new Date(Date.now() - days * 86_400_000);
    const counts = new Map<string, { entry: PlayHistoryEntity; plays: number }>();
    await db.playHistory.where('playedAt').above(since).each((entry) => {
      const existing = counts.get(entry.trackId);
      if (existing) {
        existing.plays++;
        if (entry.playedAt > existing.entry.playedAt) existing.entry = entry;
      } else {
        counts.set(entry.trackId, { entry, plays: 1 });
      }
    });
    return [...counts.values()]
      .sort((a, b) => b.plays - a.plays || +b.entry.playedAt - +a.entry.playedAt)
      .slice(0, limit)
      .map(({ entry, plays }) => this.toItem(entry, plays))
      .filter((i): i is HistoryItem => i !== null);
  }

  async clear(): Promise<void> {
    await db.playHistory.clear();
  }
}

export const playHistory = new PlayHistoryService();
