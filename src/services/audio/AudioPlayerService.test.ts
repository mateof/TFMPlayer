import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Track } from '@/types/models';

// ---- Fake media element ----------------------------------------------------
// jsdom has no media playback: emulate just enough of HTMLMediaElement.
interface FakeState {
  paused: boolean;
  currentTime: number;
  duration: number;
  ended: boolean;
}
const state = new WeakMap<HTMLMediaElement, FakeState>();
const st = (el: HTMLMediaElement) => {
  let s = state.get(el);
  if (!s) {
    s = { paused: true, currentTime: 0, duration: NaN, ended: false };
    state.set(el, s);
  }
  return s;
};
// When true, play() resolves but 'playing' is only fired by the test
let holdPlaying = false;

beforeEach(() => {
  const proto = window.HTMLMediaElement.prototype;
  Object.defineProperty(proto, 'paused', { configurable: true, get() { return st(this).paused; } });
  Object.defineProperty(proto, 'ended', { configurable: true, get() { return st(this).ended; } });
  Object.defineProperty(proto, 'duration', { configurable: true, get() { return st(this).duration; } });
  Object.defineProperty(proto, 'currentTime', {
    configurable: true,
    get() { return st(this).currentTime; },
    set(v: number) { st(this).currentTime = v; }
  });
  proto.play = function (this: HTMLMediaElement) {
    st(this).paused = false;
    this.dispatchEvent(new Event('play'));
    if (!holdPlaying) this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  };
  proto.pause = function (this: HTMLMediaElement) {
    if (!st(this).paused) {
      st(this).paused = true;
      this.dispatchEvent(new Event('pause'));
    }
  };
  proto.load = function (this: HTMLMediaElement) {
    st(this).currentTime = 0;
    st(this).duration = this.getAttribute('src') ? 100 : NaN;
  };
});

vi.mock('@/services/api/client', () => ({
  buildStreamUrlWithAuth: async (_c: string, fileId: string) => `http://server/stream/${fileId}`,
  buildLocalStreamUrlWithAuth: async (path: string) => `http://server/local/${path}`,
  apiClient: { onReset: () => {} }
}));
vi.mock('@/services/cache/PlaybackCacheService', () => ({
  playbackCache: { onCached: () => {}, onProgress: () => {}, cacheTrackInBackground: async () => {}, cancel: () => {} }
}));
vi.mock('@/services/queue/QueueSourceService', () => ({ loadNextQueuePage: async () => {} }));

import { audioPlayer } from './AudioPlayerService';
import { usePlayerStore } from '@/stores/playerStore';
import { useSettingsStore } from '@/stores/settingsStore';

const track = (id: string): Track => ({
  fileId: id, channelId: '1', channelName: 'c', fileName: `${id}.mp3`, filePath: '/', fileType: '.mp3',
  fileSize: 1, order: 0, dateAdded: '', isLocalFile: false, streamUrl: ''
});

// Internals are what these tests are about
type Internals = { elements: [HTMLAudioElement, HTMLAudioElement]; audio: HTMLAudioElement; outgoing: HTMLAudioElement | null };
const internals = () => audioPlayer as unknown as Internals;

// IndexedDB (fake) needs a few macrotasks, especially on first open
const flush = () => new Promise((r) => setTimeout(r, 30));

function tick(el: HTMLAudioElement, time: number) {
  st(el).currentTime = time;
  el.dispatchEvent(new Event('timeupdate'));
}

async function startQueue(ids: string[]) {
  const tracks = ids.map(track);
  await audioPlayer.play(tracks[0], tracks, 0);
  const el = internals().audio;
  st(el).duration = 100;
  el.dispatchEvent(new Event('loadedmetadata'));
  return el;
}

describe('AudioPlayerService track changes', () => {
  beforeEach(() => {
    holdPlaying = false;
    audioPlayer.stop();
    usePlayerStore.setState({ shuffle: false, repeatMode: 'none', sleepTimerEndsAt: null, sleepAtEndOfTrack: false });
    useSettingsStore.setState({ crossfadeSeconds: 0 });
  });

  afterEach(() => {
    audioPlayer.stop();
  });

  it('prepares the next track in the other element before the end', async () => {
    const a = await startQueue(['a', 'b']);
    const [e0, e1] = internals().elements;
    const standby = a === e0 ? e1 : e0;

    tick(a, 50);
    await flush();
    expect(standby.getAttribute('src')).toBeNull(); // too early

    tick(a, 75);
    await flush();
    expect(standby.getAttribute('src')).toBe('http://server/stream/b');
  });

  it('starts the next track while the current one still sounds (screen-off safe)', async () => {
    const a = await startQueue(['a', 'b']);
    tick(a, 75);
    await flush();

    holdPlaying = true; // the new element has not produced sound yet
    tick(a, 99.8);
    await flush();

    const b = internals().audio;
    expect(b).not.toBe(a);
    expect(usePlayerStore.getState().currentTrack?.fileId).toBe('b');
    // The old track must keep playing until the new one is really playing
    expect(a.paused).toBe(false);
    expect(internals().outgoing).toBe(a);
    // and its 'pause' never reaches the UI/media session as a pause
    expect(usePlayerStore.getState().state).not.toBe('paused');

    b.dispatchEvent(new Event('playing'));
    expect(a.paused).toBe(true);
    expect(a.getAttribute('src')).toBeNull();
    expect(internals().outgoing).toBeNull();
    expect(usePlayerStore.getState().state).toBe('playing');
  });

  it('still advances when the loop wraps before the next track was ready', async () => {
    const a = await startQueue(['a', 'b']);
    expect(a.loop).toBe(false);
    tick(a, 20); // not prepared yet (more than 30 s left)
    await new Promise((r) => setTimeout(r, 2100)); // past the seek-suppress window
    tick(a, 95);
    expect(a.loop).toBe(true); // end-guard: 'ended' can never fire
    tick(a, 0.2); // wrapped
    await flush();
    await flush();
    expect(usePlayerStore.getState().currentTrack?.fileId).toBe('b');
  });

  it('pauses at the end of the track with the "end of track" sleep timer', async () => {
    const a = await startQueue(['a', 'b']);
    audioPlayer.setSleepTimer('track');
    tick(a, 99.9);
    expect(a.paused).toBe(true);
    expect(usePlayerStore.getState().currentTrack?.fileId).toBe('a');
    expect(usePlayerStore.getState().sleepAtEndOfTrack).toBe(false);
  });

  it('crossfades: both play, the fade starts once the new track sounds', async () => {
    useSettingsStore.setState({ crossfadeSeconds: 5 });
    const a = await startQueue(['a', 'b']);
    tick(a, 70);
    await flush();
    holdPlaying = true;
    tick(a, 95.1); // within the 5 s fade window
    await flush();
    const b = internals().audio;
    expect(b).not.toBe(a);
    expect(a.paused).toBe(false);
    expect(b.volume).toBe(0); // starts silent
    b.dispatchEvent(new Event('playing'));
    expect(internals().outgoing).toBe(a); // still fading out
  });

  it('a user skip while visible switches at once (no overlap)', async () => {
    const a = await startQueue(['a', 'b']);
    await audioPlayer.next();
    expect(a.paused).toBe(true);
    expect(internals().outgoing).toBeNull();
    expect(usePlayerStore.getState().currentTrack?.fileId).toBe('b');
  });
});
