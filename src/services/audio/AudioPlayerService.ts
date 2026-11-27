import { usePlayerStore } from '@/stores/playerStore';
import { db } from '@/db/database';
import { buildStreamUrlWithAuth, buildLocalStreamUrlWithAuth } from '@/services/api/client';
import { cacheService } from '@/services/cache/CacheService';
import { playbackCache } from '@/services/cache/PlaybackCacheService';
import { loadNextQueuePage } from '@/services/queue/QueueSourceService';
import { playHistory } from '@/services/history/PlayHistoryService';
import { preloadOnServer } from '@/services/server/serverPreload';
import { resumeService } from '@/services/player/ResumeService';
import { audioMetadataService } from '@/services/audio/AudioMetadataService';
import { replayGainFactor, type ReplayGainInfo } from './replayGain';
import { formatDuration } from '@/utils/format';
import { useSettingsStore, type SoundEnhancementSettings } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';
import { EQ_BANDS } from '@/utils/eqPresets';
import { log } from '@/utils/logger';
import { t } from '@/i18n';
import type { Track } from '@/types/models';

// When this many (or fewer) tracks remain after the current one, page in more
const QUEUE_PREFETCH_THRESHOLD = 10;

// How long before the end the next track is loaded into the standby element
const PREPARE_LEAD_SECONDS = 30;

// Without crossfade the next track starts this close to the end. timeupdate
// fires every ~250 ms, so this lands the changeover right at the boundary
// with the old track still sounding (no silent gap at all).
const GAPLESS_LEAD_SECONDS = 0.3;

// Sleep timer: fade the volume out over the last seconds before pausing
const SLEEP_FADE_SECONDS = 10;

// Never crossfade tracks shorter than this many times the fade length
const MIN_CROSSFADE_TRACK_RATIO = 3;

interface ElementNodes {
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}

interface PreparedSource {
  trackId: string;
  blob: Blob | null;
}

/**
 * Playback engine.
 *
 * Two <audio> elements take turns: while one plays, the other loads the next
 * track; at the end the next one starts BEFORE the current one is released.
 * The page therefore never goes silent between tracks, which is what keeps
 * Android from freezing it (and dropping the media notification) when the
 * screen is off. The same overlap gives gapless playback and crossfade.
 */
class AudioPlayerService {
  private readonly elements: [HTMLAudioElement, HTMLAudioElement];
  // The element the UI, the media session and every control act on
  private audio: HTMLAudioElement;
  // The previous element while it fades/overlaps into the new one
  private outgoing: HTMLAudioElement | null = null;
  private outgoingWrapped = false;
  // startedAt stays 0 until the incoming track actually sounds
  private crossfade: { durationMs: number; startedAt: number } | null = null;

  private mediaSessionEnabled = typeof navigator !== 'undefined' && 'mediaSession' in navigator;
  private blobUrls = new Map<HTMLAudioElement, string>();
  // Next track already loaded into the standby element
  private prepared: PreparedSource | null = null;
  private preparingFor: string | null = null;
  // Shuffle picks the next track ahead of time so it can be prepared too
  private plannedNextIndex: number | null = null;

  // Blob of the current track once it finishes auto-caching, so seeks can
  // switch to the local copy instead of re-downloading from the network
  private cachedBlobForCurrentTrack: Blob | null = null;
  private lastBufferedKey = '';

  // Playback should be (re)started by canplay/visibility/health checks
  private pendingAutoPlay = false;
  // Sound is supposed to be coming out (until the user pauses or the queue ends)
  private playbackIntent = false;
  // A new source was assigned and has not started yet: its load-algorithm
  // 'pause' must not be reported to the OS as a pause
  private transitioning = false;
  // Increments on every play() so a slow, superseded request gives up
  private playToken = 0;

  private swapLoadedListener: (() => void) | null = null;

  private healthMonitor: number | null = null;
  private lastHealthPosition = -1;
  private stallTicks = 0;

  private errorRetryTrackId: string | null = null;
  private errorRetryCount = 0;
  private consecutiveErrorSkips = 0;

  // End-guard (fallback when the next track wasn't ready in time): the active
  // element loops whenever something follows, so 'ended' never fires and the
  // wrap back to 0 is turned into the track change
  private lastTimeupdatePos = 0;
  private seekSuppressUntil = 0;

  // Volume the user chose; per-element fade levels multiply it
  private masterVolume = 1;
  private levels = new Map<HTMLAudioElement, number>();
  // Track each element holds, for its ReplayGain (and the gains read so far)
  private elementTracks = new Map<HTMLAudioElement, string>();
  private replayGains = new Map<string, ReplayGainInfo>();

  // Restored session: where to resume when play is first pressed
  private resumeAt: number | null = null;

  // Web Audio: visualizer + sound enhancement DSP chain
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private streamSourceNode: MediaStreamAudioSourceNode | null = null;
  private visualizerInitialized = false;
  private nodes = new Map<HTMLAudioElement, ElementNodes>();
  private mixBus: GainNode | null = null;
  private chainInput: GainNode | null = null;
  private chainOutput: AudioNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private bassFilter: BiquadFilterNode | null = null;
  private sideGain: GainNode | null = null;
  private mergerNode: ChannelMergerNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private makeupGain: GainNode | null = null;
  private limiter: DynamicsCompressorNode | null = null;
  private dspEnabled = false;

  private currentCoverArt: string | null = null;
  private lastPositionUpdate = 0;
  private readonly positionUpdateInterval = 5000;
  private lastPersistAt = 0;

  constructor() {
    this.elements = [this.createElement(), this.createElement()];
    this.audio = this.elements[0];
    this.elements.forEach((el) => this.setupEventListeners(el));
    this.setupDocumentListeners();
    if (this.mediaSessionEnabled) this.setupMediaSession();

    this.masterVolume = usePlayerStore.getState().volume ?? 1;

    // Speed and volume levelling follow the settings live
    useSettingsStore.subscribe((s, prev) => {
      if (s.playbackRate !== prev.playbackRate) {
        this.elements.forEach((el) => {
          el.defaultPlaybackRate = s.playbackRate || 1;
          el.playbackRate = s.playbackRate || 1;
        });
        this.updatePositionState();
      }
      if (s.replayGain !== prev.replayGain) {
        this.elements.forEach((el) => this.applyLevel(el));
        const current = usePlayerStore.getState().currentTrack;
        if (s.replayGain && current) void this.loadReplayGain(current);
      }
    });

    playbackCache.onCached((trackId, blob) => {
      const store = usePlayerStore.getState();
      if (store.currentTrack?.fileId === trackId) {
        this.cachedBlobForCurrentTrack = blob;
        store.setCachedPercent(100);
      }
    });

    playbackCache.onProgress((trackId, percent) => {
      const store = usePlayerStore.getState();
      if (store.currentTrack?.fileId === trackId) {
        store.setCachedPercent(percent);
      }
    });
  }

  private createElement(): HTMLAudioElement {
    const el = new Audio();
    // Sources are assigned only when about to play (or to prepare the next
    // track): buffering eagerly shortens every changeover
    el.preload = 'auto';
    // CORS for the visualizer / Web Audio graph
    el.crossOrigin = 'anonymous';
    return el;
  }

  private get standby(): HTMLAudioElement {
    return this.audio === this.elements[0] ? this.elements[1] : this.elements[0];
  }

  // ---------------------------------------------------------------------------
  // Volume
  // ---------------------------------------------------------------------------

  private applyLevel(el: HTMLAudioElement): void {
    const node = this.nodes.get(el);
    const level = (this.levels.get(el) ?? 1) * this.trackGainFactor(el, !!node);
    if (node) {
      // Routed through Web Audio: the gain node is the single source of truth
      el.volume = 1;
      node.gain.gain.value = this.masterVolume * level;
    } else {
      el.volume = Math.max(0, Math.min(1, this.masterVolume * level));
    }
  }

  private setLevel(el: HTMLAudioElement, level: number): void {
    this.levels.set(el, Math.max(0, Math.min(1, level)));
    this.applyLevel(el);
  }

  // ReplayGain of the track an element holds (1 when off or untagged)
  private trackGainFactor(el: HTMLAudioElement, canBoost: boolean): number {
    if (!useSettingsStore.getState().replayGain) return 1;
    const trackId = this.elementTracks.get(el);
    return replayGainFactor(trackId ? this.replayGains.get(trackId) : undefined, canBoost);
  }

  /** An element now holds this track: speed, and its ReplayGain once known. */
  private bindTrack(el: HTMLAudioElement, track: Track): void {
    this.elementTracks.set(el, track.fileId);
    const rate = useSettingsStore.getState().playbackRate || 1;
    el.defaultPlaybackRate = rate;
    el.playbackRate = rate;
    this.applyLevel(el);
    void this.loadReplayGain(track);
  }

  private async loadReplayGain(track: Track): Promise<void> {
    if (!useSettingsStore.getState().replayGain || this.replayGains.has(track.fileId)) return;
    try {
      const cached = await db.cachedTracks.get(track.fileId);
      let info: ReplayGainInfo | null = cached?.replayGainDb !== undefined
        ? { db: cached.replayGainDb, peak: cached.replayGainPeak }
        : null;
      if (!info) {
        // Streamed (or downloaded before the tag was read): the head of the file
        const meta = await audioMetadataService.getMetadata(track.fileId, track.streamUrl, track.fileSize);
        if (meta?.replayGainDb !== undefined) info = { db: meta.replayGainDb, peak: meta.replayGainPeak };
      }
      if (!info) return;
      if (this.replayGains.size > 500) this.replayGains.clear();
      this.replayGains.set(track.fileId, info);
      this.elements.forEach((el) => {
        if (this.elementTracks.get(el) === track.fileId) this.applyLevel(el);
      });
    } catch (error) {
      log.debug('No ReplayGain for', track.fileName, error);
    }
  }

  setVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.elements.forEach((el) => this.applyLevel(el));
    usePlayerStore.getState().setVolume(this.masterVolume);
  }

  // ---------------------------------------------------------------------------
  // Visualizer and DSP
  // ---------------------------------------------------------------------------

  initVisualizer(): AnalyserNode | null {
    if (this.analyserNode && this.audioContext) {
      this.resumeAudioContext();
      return this.analyserNode;
    }
    try {
      this.audioContext = this.ensureAudioContext();
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 8192;
      this.analyserNode.smoothingTimeConstant = 0.7;
      this.analyserNode.minDecibels = -90;
      this.analyserNode.maxDecibels = -10;
      this.visualizerInitialized = true;
      this.connectVisualizerStream();
      return this.analyserNode;
    } catch (error) {
      console.error('Failed to initialize visualizer:', error);
      return null;
    }
  }

  private connectVisualizerStream(): void {
    if (!this.audioContext || !this.analyserNode) return;

    // With the Web Audio graph active, tap the graph instead of captureStream
    if (this.mixBus) {
      this.applyDspRouting(this.dspEnabled);
      return;
    }

    try {
      if (this.streamSourceNode) {
        this.streamSourceNode.disconnect();
        this.streamSourceNode = null;
      }
      const el = this.audio as HTMLAudioElement & { captureStream?: () => MediaStream };
      if (el.captureStream) {
        const stream = el.captureStream();
        if (stream.getAudioTracks().length > 0) {
          this.streamSourceNode = this.audioContext.createMediaStreamSource(stream);
          // Analysis only: never connected to the destination
          this.streamSourceNode.connect(this.analyserNode);
        }
      }
    } catch (error) {
      console.warn('Could not connect visualizer stream:', error);
    }
  }

  refreshVisualizer(): void {
    // Nothing to draw with the screen off; reconnects on visibilitychange
    if (document.hidden) return;
    this.resumeAudioContext();
    if (this.visualizerInitialized) {
      setTimeout(() => this.connectVisualizerStream(), 100);
    }
  }

  getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  async resumeAudioContext(): Promise<void> {
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();
      // The OS may suspend the context (screen off, focus changes) while
      // sound flows through it: resume at once or playback goes silent
      this.audioContext.addEventListener('statechange', () => {
        if (this.audioContext && this.audioContext.state !== 'running' && this.mixBus && !this.audio.paused) {
          this.audioContext.resume().catch(() => {});
        }
      });
    }
    return this.audioContext;
  }

  // Both elements get their own source + gain (used for crossfades) into a
  // shared mix bus. Once an element has a MediaElementSource it only sounds
  // through the graph, so both are wired at the same time.
  private ensureElementNodes(): boolean {
    if (this.mixBus) return true;
    try {
      const ctx = this.ensureAudioContext();
      this.mixBus = ctx.createGain();
      for (const el of this.elements) {
        const source = ctx.createMediaElementSource(el);
        const gain = ctx.createGain();
        source.connect(gain);
        gain.connect(this.mixBus);
        this.nodes.set(el, { source, gain });
        this.applyLevel(el);
      }
      this.mixBus.connect(ctx.destination);
      return true;
    } catch (error) {
      console.error('Failed to build the audio graph:', error);
      return false;
    }
  }

  // source → EQ (10 bands) → bass boost → stereo widener → compressor →
  // makeup gain → limiter
  private buildDspGraph(): boolean {
    if (!this.ensureElementNodes()) return false;
    if (this.chainInput && this.chainOutput) return true;
    try {
      const ctx = this.ensureAudioContext();
      this.chainInput = ctx.createGain();

      let node: AudioNode = this.chainInput;
      this.eqFilters = EQ_BANDS.map((freq, i) => {
        const filter = ctx.createBiquadFilter();
        filter.type = i === 0 ? 'lowshelf' : i === EQ_BANDS.length - 1 ? 'highshelf' : 'peaking';
        filter.frequency.value = freq;
        filter.Q.value = 1.1;
        filter.gain.value = 0;
        node.connect(filter);
        node = filter;
        return filter;
      });

      this.bassFilter = ctx.createBiquadFilter();
      this.bassFilter.type = 'lowshelf';
      this.bassFilter.frequency.value = 80;
      this.bassFilter.gain.value = 0;
      node.connect(this.bassFilter);

      // Stereo widener: mid (L+R) / side (L-R), side amplified
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);
      const lToMid = ctx.createGain(); lToMid.gain.value = 0.5;
      const rToMid = ctx.createGain(); rToMid.gain.value = 0.5;
      const lToSide = ctx.createGain(); lToSide.gain.value = 0.5;
      const rToSide = ctx.createGain(); rToSide.gain.value = -0.5;
      const mid = ctx.createGain();
      this.sideGain = ctx.createGain();
      this.sideGain.gain.value = 1;
      const sideInvert = ctx.createGain();
      sideInvert.gain.value = -1;

      this.bassFilter.connect(splitter);
      splitter.connect(lToMid, 0);
      splitter.connect(lToSide, 0);
      splitter.connect(rToMid, 1);
      splitter.connect(rToSide, 1);
      lToMid.connect(mid);
      rToMid.connect(mid);
      lToSide.connect(this.sideGain);
      rToSide.connect(this.sideGain);
      mid.connect(merger, 0, 0);
      mid.connect(merger, 0, 1);
      this.sideGain.connect(merger, 0, 0);
      this.sideGain.connect(sideInvert);
      sideInvert.connect(merger, 0, 1);
      this.mergerNode = merger;

      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -24;
      this.compressor.knee.value = 20;
      this.compressor.ratio.value = 2.5;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.25;
      this.makeupGain = ctx.createGain();

      // Safety limiter, always last
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1.5;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.001;
      this.limiter.release.value = 0.1;

      merger.connect(this.makeupGain);
      this.compressor.connect(this.makeupGain);
      this.makeupGain.connect(this.limiter);
      this.chainOutput = this.limiter;
      return true;
    } catch (error) {
      console.error('Failed to build DSP graph:', error);
      return false;
    }
  }

  private applyDspRouting(enabled: boolean): void {
    if (!this.mixBus || !this.audioContext) return;
    const canChain = !!(this.chainInput && this.chainOutput);

    this.mixBus.disconnect();
    this.chainOutput?.disconnect();

    const useChain = enabled && canChain;
    if (useChain) this.mixBus.connect(this.chainInput!);
    const tail = useChain ? this.chainOutput! : this.mixBus;
    tail.connect(this.audioContext.destination);
    if (this.analyserNode) tail.connect(this.analyserNode);
    this.dspEnabled = useChain;
  }

  applySoundSettings(sound: SoundEnhancementSettings): void {
    if (sound.enabled) {
      if (!this.buildDspGraph()) return;
      this.resumeAudioContext();

      this.eqFilters.forEach((filter, i) => {
        filter.gain.value = sound.eqGains[i] ?? 0;
      });
      this.bassFilter!.gain.value = sound.bassBoost;
      this.sideGain!.gain.value = 1 + sound.stereoWidth / 100;

      this.mergerNode!.disconnect();
      if (sound.loudness) {
        this.mergerNode!.connect(this.compressor!);
        this.makeupGain!.gain.value = Math.pow(10, 7 / 20);
      } else {
        this.mergerNode!.connect(this.makeupGain!);
        this.makeupGain!.gain.value = 1;
      }
      this.applyDspRouting(true);
    } else if (this.mixBus) {
      this.applyDspRouting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------

  private setupDocumentListeners(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.persistPosition(true);
        return;
      }
      if (this.pendingAutoPlay && this.audio.paused && this.audio.src) {
        this.audio.play().catch((e) => log.warn('Retry on visible failed', e));
      }
      if (this.visualizerInitialized) this.refreshVisualizer();
    });

    // Save where we were when the app is closed or killed
    window.addEventListener('pagehide', () => this.persistPosition(true));
  }

  private setupEventListeners(el: HTMLAudioElement): void {
    const store = usePlayerStore.getState;
    // Events from the element that is not (or no longer) active are noise:
    // its load/pause/end must never reach the UI or the OS media session
    const isActive = () => el === this.audio;

    el.addEventListener('loadstart', () => {
      if (isActive() && this.transitioning) store().setState('loading');
    });

    const onDuration = () => {
      if (!isActive()) return;
      const duration = el.duration;
      if (Number.isFinite(duration) && duration > 0) {
        store().setDuration(duration);
        this.updatePositionState();
      }
    };
    el.addEventListener('loadedmetadata', onDuration);
    el.addEventListener('durationchange', onDuration);

    el.addEventListener('canplay', () => {
      if (isActive() && this.pendingAutoPlay && el.paused) {
        el.play().catch((e) => log.warn('play() on canplay failed', e));
      }
    });

    el.addEventListener('play', () => {
      if (!isActive()) return;
      store().setState('playing');
      this.updateMediaSession();
      if (this.mediaSessionEnabled) {
        navigator.mediaSession.playbackState = 'playing';
        this.lastPositionUpdate = Date.now();
        setTimeout(() => this.updatePositionState(), 150);
      }
    });

    el.addEventListener('playing', () => {
      if (!isActive()) return;
      this.pendingAutoPlay = false;
      this.transitioning = false;
      this.errorRetryCount = 0;
      this.consecutiveErrorSkips = 0;
      this.stallTicks = 0;
      store().setState('playing');
      // The new track is sounding: the old one can go now (unless it is
      // crossfading out, in which case the fade releases it)
      if (this.outgoing && !this.crossfade) this.releaseOutgoing();
      // Crossfade clock starts when the incoming track really sounds
      if (this.crossfade && this.crossfade.startedAt === 0) this.crossfade.startedAt = performance.now();
    });

    el.addEventListener('pause', () => {
      if (!isActive()) return;
      // A track change is not a pause: keep announcing 'playing' so the
      // media session (and the page's right to run in background) survives
      if (this.transitioning || el.ended) return;
      store().setState('paused');
      if (this.mediaSessionEnabled) {
        navigator.mediaSession.playbackState = 'paused';
        this.updatePositionState();
      }
      this.persistPosition(true);
      resumeService.report(store().currentTrack, el.currentTime, el.duration, true);
    });

    el.addEventListener('ended', () => {
      if (isActive()) this.handleTrackEnd();
    });

    el.addEventListener('timeupdate', () => {
      if (el === this.outgoing) {
        this.handleOutgoingTick(el);
        return;
      }
      if (!isActive()) return;
      this.handleTransitionTiming();
      this.handleSleepTimer();
      this.updateCrossfade();
      store().setPosition(el.currentTime);
      this.updateBufferedRanges();
      this.maybePrepareNext();
      playHistory.tick(store().currentTrack, el.currentTime, el.duration, !el.paused);
      resumeService.report(store().currentTrack, el.currentTime, el.duration);
      this.persistPosition(false);
      const now = Date.now();
      if (now - this.lastPositionUpdate >= this.positionUpdateInterval) {
        this.lastPositionUpdate = now;
        this.updatePositionState();
      }
    });

    el.addEventListener('progress', () => {
      if (isActive()) this.updateBufferedRanges();
    });

    el.addEventListener('waiting', () => {
      if (isActive()) store().setState('buffering');
    });

    el.addEventListener('error', () => {
      // Clearing a source fires a spurious error: ignore it
      if (!el.src || el.src === window.location.href) return;

      if (!isActive()) {
        // The standby element failed to load the next track: play() will
        // load it again the normal way when the time comes
        if (el === this.standby && this.prepared) {
          log.warn('Preparing the next track failed; it will load on demand');
          this.prepared = null;
          this.preparingFor = null;
        }
        return;
      }

      const error = el.error;
      console.error('Audio error:', { code: error?.code, message: error?.message, src: el.src?.substring(0, 100) });

      const { currentTrack, queue, currentIndex } = usePlayerStore.getState();
      if (this.playbackIntent && currentTrack) {
        if (this.errorRetryTrackId !== currentTrack.fileId) {
          this.errorRetryTrackId = currentTrack.fileId;
          this.errorRetryCount = 0;
        }
        if (this.errorRetryCount < 2) {
          this.errorRetryCount++;
          log.warn(`Retrying track after error (attempt ${this.errorRetryCount})`);
          window.setTimeout(() => {
            if (this.playbackIntent) this.play(currentTrack).catch(() => {});
          }, 1000);
          return;
        }
        if (this.consecutiveErrorSkips < 5 && currentIndex < queue.length - 1) {
          this.consecutiveErrorSkips++;
          log.warn('Track failed repeatedly, skipping to next');
          this.next({ auto: true }).catch(() => {});
          return;
        }
      }
      this.releaseOutgoing();
      store().setState('error');
      store().setError(error?.message || t('Playback error'));
    });
  }

  // ---------------------------------------------------------------------------
  // Media Session
  // ---------------------------------------------------------------------------

  private setupMediaSession(): void {
    const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
      ['play', () => this.resume()],
      ['pause', () => this.pause()],
      ['stop', () => this.pause()],
      ['previoustrack', () => { this.previous(); }],
      ['nexttrack', () => { this.next(); }],
      ['seekto', (details) => {
        if (details.seekTime !== undefined) this.seek(details.seekTime);
      }],
      ['seekbackward', (details) => {
        const skip = details.seekOffset || useSettingsStore.getState().skipBackSeconds || 10;
        this.seek(Math.max(this.audio.currentTime - skip, 0));
      }],
      ['seekforward', (details) => {
        const skip = details.seekOffset || useSettingsStore.getState().skipForwardSeconds || 10;
        this.seek(Math.min(this.audio.currentTime + skip, this.audio.duration));
      }]
    ];
    for (const [action, handler] of handlers) {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Action not supported by this browser
      }
    }
  }

  private updateMediaSession(): void {
    if (!this.mediaSessionEnabled) return;
    const track = usePlayerStore.getState().currentTrack;
    if (!track) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || track.fileName,
      artist: track.artist || track.channelName,
      album: track.album || '',
      artwork: this.artworkFor()
    });
    this.updatePositionState();
  }

  // Desktop media controls (Windows, macOS, Linux) ignore SVG artwork, so
  // the fallback is the app icon rasterised to PNG once
  private fallbackArtwork: string | null = null;
  private artworkFor(): MediaImage[] {
    if (this.currentCoverArt) {
      return [{ src: this.currentCoverArt, sizes: '512x512', type: 'image/jpeg' }];
    }
    const baseUrl = import.meta.env.BASE_URL || '/';
    const images: MediaImage[] = [];
    if (this.fallbackArtwork) images.push({ src: this.fallbackArtwork, sizes: '512x512', type: 'image/png' });
    images.push(
      { src: `${baseUrl}pwa-192x192.svg`, sizes: '192x192', type: 'image/svg+xml' },
      { src: `${baseUrl}pwa-512x512.svg`, sizes: '512x512', type: 'image/svg+xml' }
    );
    if (!this.fallbackArtwork) this.rasterizeFallbackArtwork();
    return images;
  }

  private rasterizeFallbackArtwork(): void {
    if (this.fallbackArtwork !== null || typeof document === 'undefined') return;
    this.fallbackArtwork = '';
    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 512;
        canvas.getContext('2d')?.drawImage(img, 0, 0, 512, 512);
        this.fallbackArtwork = canvas.toDataURL('image/png');
        if (!this.currentCoverArt) this.updateMediaSession();
      } catch {
        this.fallbackArtwork = '';
      }
    };
    img.src = `${import.meta.env.BASE_URL || '/'}pwa-512x512.svg`;
  }

  updateCoverArt(coverArtDataUrl: string | null): void {
    this.currentCoverArt = coverArtDataUrl;
    if (this.mediaSessionEnabled && coverArtDataUrl) this.updateMediaSession();
  }

  private updatePositionState(): void {
    if (!this.mediaSessionEnabled) return;
    const duration = this.audio.duration;
    const position = this.audio.currentTime;
    if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) return;
    if (!Number.isFinite(position) || position < 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration,
        playbackRate: this.audio.playbackRate || 1,
        position: Math.min(Math.max(0, position), duration)
      });
    } catch {
      // Not supported
    }
  }

  forceUpdatePositionState(): void {
    this.updatePositionState();
  }

  private updateBufferedRanges(): void {
    const buffered = this.audio.buffered;
    const ranges: { start: number; end: number }[] = [];
    for (let i = 0; i < buffered.length; i++) {
      ranges.push({ start: buffered.start(i), end: buffered.end(i) });
    }
    const key = ranges.map((r) => `${r.start.toFixed(1)}-${r.end.toFixed(1)}`).join(',');
    if (key === this.lastBufferedKey) return;
    this.lastBufferedKey = key;
    usePlayerStore.getState().setBufferedRanges(ranges);
  }

  // ---------------------------------------------------------------------------
  // Sources and the standby element
  // ---------------------------------------------------------------------------

  private async resolveSource(track: Track): Promise<{ blob: Blob | null; url: string | null }> {
    try {
      const cached = await db.cachedTracks.get(track.fileId);
      if (cached?.blob) return { blob: cached.blob, url: null };
    } catch (e) {
      log.warn('Error checking cache:', e);
    }
    const url = track.isLocalFile
      ? await buildLocalStreamUrlWithAuth(track.filePath)
      : await buildStreamUrlWithAuth(track.channelId, track.fileId, track.fileName);
    return { blob: null, url };
  }

  private assignSource(el: HTMLAudioElement, source: { blob: Blob | null; url: string | null }): void {
    this.revokeElementUrl(el);
    let url = source.url;
    if (source.blob) {
      url = URL.createObjectURL(source.blob);
      this.blobUrls.set(el, url);
    }
    if (!url) throw new Error('No playable source for track');
    el.loop = false;
    el.src = url;
  }

  private revokeElementUrl(el: HTMLAudioElement): void {
    const url = this.blobUrls.get(el);
    if (url) {
      URL.revokeObjectURL(url);
      this.blobUrls.delete(el);
    }
  }

  // Stop an element and let go of its source
  private releaseElement(el: HTMLAudioElement): void {
    el.loop = false;
    el.pause();
    if (el.src) {
      el.removeAttribute('src');
      el.load();
    }
    this.revokeElementUrl(el);
    this.setLevel(el, 1);
  }

  private releaseOutgoing(): void {
    const el = this.outgoing;
    this.outgoing = null;
    this.outgoingWrapped = false;
    this.crossfade = null;
    if (el && el !== this.audio) this.releaseElement(el);
    this.setLevel(this.audio, 1);
  }

  // The outgoing element is still sounding: drive the fade, or once it wraps
  // around (no crossfade, next track still loading) keep it very quiet so it
  // holds the audio session without replaying the old song out loud
  private handleOutgoingTick(el: HTMLAudioElement): void {
    if (this.crossfade) {
      // The old track wrapped around before the fade finished: cut it there
      // rather than replay its beginning under the new one
      if (el.currentTime < 2 && this.crossfade.startedAt > 0) {
        this.releaseOutgoing();
        return;
      }
      this.updateCrossfade();
      return;
    }
    if (!this.outgoingWrapped && el.currentTime < 2) {
      this.outgoingWrapped = true;
      this.setLevel(el, 0.03);
    }
  }

  private updateCrossfade(): void {
    if (!this.crossfade || !this.outgoing || this.crossfade.startedAt === 0) return;
    const progress = Math.min(1, (performance.now() - this.crossfade.startedAt) / this.crossfade.durationMs);
    // Equal-power curves keep the perceived loudness steady
    this.setLevel(this.outgoing, Math.cos((progress * Math.PI) / 2));
    this.setLevel(this.audio, Math.sin((progress * Math.PI) / 2));
    if (progress >= 1) this.releaseOutgoing();
  }

  /** Index that follows the current one (planned ahead for shuffle). */
  private peekNextIndex(): number {
    const { queue, currentIndex, shuffle, repeatMode } = usePlayerStore.getState();
    if (queue.length === 0) return -1;
    if (shuffle) {
      if (queue.length < 2) return repeatMode === 'all' ? currentIndex : -1;
      if (this.plannedNextIndex === null || this.plannedNextIndex === currentIndex || this.plannedNextIndex >= queue.length) {
        let pick = Math.floor(Math.random() * (queue.length - 1));
        if (pick >= currentIndex) pick++;
        this.plannedNextIndex = pick;
      }
      return this.plannedNextIndex;
    }
    if (currentIndex < queue.length - 1) return currentIndex + 1;
    return repeatMode === 'all' ? 0 : -1;
  }

  private crossfadeSecondsFor(duration: number): number {
    const seconds = useSettingsStore.getState().crossfadeSeconds ?? 0;
    if (seconds <= 0 || !Number.isFinite(duration)) return 0;
    return duration >= seconds * MIN_CROSSFADE_TRACK_RATIO ? seconds : 0;
  }

  // Load the next track into the standby element while this one plays
  private maybePrepareNext(): void {
    const { queue, repeatMode } = usePlayerStore.getState();
    if (repeatMode === 'one' || this.transitioning || this.outgoing) return;
    const duration = this.audio.duration;
    if (!Number.isFinite(duration)) return;
    const lead = Math.max(PREPARE_LEAD_SECONDS, this.crossfadeSecondsFor(duration) + 15);
    if (duration - this.audio.currentTime > lead) return;

    const nextIndex = this.peekNextIndex();
    if (nextIndex < 0) return;
    const track = queue[nextIndex];
    if (!track || track.fileId === usePlayerStore.getState().currentTrack?.fileId) return;
    if (this.preparingFor === track.fileId) return;
    this.preparingFor = track.fileId;

    this.resolveSource(track)
      .then((source) => {
        // Superseded meanwhile (user skipped, queue changed)
        if (this.preparingFor !== track.fileId || this.transitioning) return;
        const el = this.standby;
        this.releaseElement(el);
        this.assignSource(el, source);
        this.bindTrack(el, track);
        el.load();
        this.prepared = { trackId: track.fileId, blob: source.blob };
        log.debug('Prepared next track', track.fileName);
      })
      .catch((e) => {
        log.warn('Could not prepare next track', e);
        this.preparingFor = null;
      });
  }

  // Decide when the next track starts: early enough for the crossfade, or
  // right at the end (gapless) when it is already loaded. If it is not ready
  // the loop wrap below still triggers the change without silence.
  private handleTransitionTiming(): void {
    const el = this.audio;
    const pos = el.currentTime;
    const prev = this.lastTimeupdatePos;
    this.lastTimeupdatePos = pos;

    const duration = el.duration;
    if (!Number.isFinite(duration) || duration <= 0) return;

    const { queue, currentIndex, repeatMode, shuffle, sleepAtEndOfTrack } = usePlayerStore.getState();
    const hasFollowUp =
      !sleepAtEndOfTrack &&
      (repeatMode === 'one' || repeatMode === 'all' || (shuffle && queue.length > 1) || currentIndex < queue.length - 1);

    if (el.loop !== hasFollowUp) el.loop = hasFollowUp;
    if (repeatMode === 'one' || this.transitioning || this.outgoing) return;

    // Sleep timer set to "end of this track"
    if (sleepAtEndOfTrack && duration - pos <= GAPLESS_LEAD_SECONDS) {
      this.finishSleep();
      return;
    }
    if (!hasFollowUp) return;

    const nextIndex = this.peekNextIndex();
    const nextReady = nextIndex >= 0 && this.prepared?.trackId === queue[nextIndex]?.fileId;
    const fade = this.crossfadeSecondsFor(duration);
    const remaining = duration - pos;

    if (nextReady && remaining <= Math.max(fade, GAPLESS_LEAD_SECONDS)) {
      log.debug(fade ? `Crossfading over ${fade}s` : 'Gapless changeover');
      this.transitioning = true;
      this.next({ auto: true, crossfadeSeconds: fade ? Math.max(remaining, 1) : 0 }).catch(() => {});
      return;
    }

    // Fallback: the loop wrapped before the next track was ready
    if (Date.now() < this.seekSuppressUntil) return;
    const wrapped =
      (prev > duration - 10 && pos < 3 && prev - pos > 2) ||
      prev - pos > Math.max(10, duration * 0.5);
    if (wrapped) {
      log.info('End-guard: loop wrap detected, advancing to next track');
      this.transitioning = true;
      this.next({ auto: true }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Playback
  // ---------------------------------------------------------------------------

  async play(
    track: Track,
    queue?: Track[],
    startIndex?: number,
    options: { auto?: boolean; crossfadeSeconds?: number; startAt?: number } = {}
  ): Promise<void> {
    const store = usePlayerStore.getState();
    const token = ++this.playToken;
    // A changeover still in progress is finished first: its outgoing element
    // is the standby one we are about to load into
    if (this.outgoing) this.releaseOutgoing();

    if (queue && queue.length > 0) {
      store.setQueue(queue);
      store.setCurrentIndex(startIndex ?? 0);
    }
    this.plannedNextIndex = null;
    store.setCurrentTrack(track);
    store.setState('loading');
    this.currentCoverArt = null;
    this.resumeAt = null;

    // Long audio (podcasts, audiobooks) starts where it was left
    if (options.startAt === undefined) {
      const resume = resumeService.positionFor(track);
      if (resume !== null) {
        options = { ...options, startAt: resume };
        useUiStore.getState().addToast(t('Resuming at {time}', { time: formatDuration(resume) }), 'info');
      }
    }

    try {
      const old = this.audio;
      const oldIsSounding = !!old.src && !old.paused && !old.ended;
      // Keep the old track sounding until the new one starts whenever the
      // change happens unattended (end of track, lock screen buttons, screen
      // off): that continuity is what Android needs to keep us alive
      const overlap = oldIsSounding && (options.auto || document.hidden);

      let target = this.standby;
      let blob: Blob | null;
      if (this.prepared?.trackId === track.fileId && target.src) {
        blob = this.prepared.blob;
      } else {
        // Resolve before touching any element: the old track keeps playing
        const source = await this.resolveSource(track);
        if (token !== this.playToken) return; // superseded
        target = this.standby;
        this.releaseElement(target);
        this.assignSource(target, source);
        blob = source.blob;
      }
      this.prepared = null;
      this.preparingFor = null;

      // From here to play() everything is synchronous
      this.transitioning = true;
      this.clearSwapLoadedListener();
      this.audio = target;
      this.bindTrack(target, track);
      this.cachedBlobForCurrentTrack = blob;
      this.lastBufferedKey = '';
      this.lastTimeupdatePos = 0;
      this.seekSuppressUntil = Date.now() + 2000;
      store.setBufferedRanges([]);
      store.setCachedPercent(blob ? 100 : 0);
      playHistory.start(track);

      if (overlap) {
        this.outgoing = old;
        this.outgoingWrapped = false;
        // Keep looping until released: if the new source is slow to start,
        // the old element must not reach 'ended' (silence) in the meantime
        old.loop = true;
        const fade = options.crossfadeSeconds ?? 0;
        if (fade > 0) {
          this.crossfade = { durationMs: fade * 1000, startedAt: 0 };
          this.setLevel(target, 0);
        } else {
          this.crossfade = null;
          this.setLevel(target, 1);
        }
      } else {
        this.setLevel(target, 1);
        if (old !== target) this.releaseElement(old);
      }

      if (options.startAt && options.startAt > 0) {
        const startAt = options.startAt;
        target.addEventListener('loadedmetadata', () => {
          if (this.audio === target) target.currentTime = startAt;
        }, { once: true });
      }

      this.pendingAutoPlay = true;
      this.playbackIntent = true;

      const { sound } = useSettingsStore.getState();
      if (sound.enabled && !this.dspEnabled) {
        this.applySoundSettings(sound);
      } else if (this.mixBus) {
        this.resumeAudioContext();
      }

      try {
        await target.play();
      } catch (playError) {
        if (playError instanceof DOMException && playError.name === 'NotAllowedError') {
          log.warn('Autoplay blocked, will retry on canplay/visibility');
        } else if (playError instanceof DOMException && playError.name === 'AbortError') {
          // Superseded by a newer source: nothing to do
        } else {
          throw playError;
        }
      }

      this.startHealthMonitor();
      this.refreshVisualizer();
      cacheService.updateLastPlayed(track.fileId).catch(() => {});

      if (!blob) {
        playbackCache.cacheTrackInBackground(track).catch(() => {});
      }

      // The server fetches the next track from Telegram while this one plays
      const upcoming = this.peekNextIndex();
      if (upcoming >= 0 && upcoming !== usePlayerStore.getState().currentIndex) {
        void preloadOnServer(usePlayerStore.getState().queue[upcoming]);
      }

      const { queue: currentQueue, currentIndex, queueSource } = usePlayerStore.getState();
      if (queueSource?.hasMore && currentQueue.length - 1 - currentIndex <= QUEUE_PREFETCH_THRESHOLD) {
        loadNextQueuePage().catch((e) => log.warn('Queue prefetch failed:', e));
      }
    } catch (error) {
      console.error('Playback error:', error);
      this.transitioning = false;
      this.releaseOutgoing();
      store.setState('error');
      store.setError(t('Failed to play track'));
    }
  }

  async playAtIndex(index: number, options: { auto?: boolean; crossfadeSeconds?: number } = {}): Promise<void> {
    const store = usePlayerStore.getState();
    const { queue } = store;
    if (index >= 0 && index < queue.length) {
      store.setCurrentIndex(index);
      await this.play(queue[index], undefined, undefined, options);
    }
  }

  pause(): void {
    this.pendingAutoPlay = false;
    this.playbackIntent = false;
    this.transitioning = false;
    this.stopHealthMonitor();
    this.releaseOutgoing();
    this.audio.pause();
  }

  resume(): void {
    if (!this.audio.src) {
      // Restored session: load the remembered track where it was left
      this.resumeRestored();
      return;
    }
    this.pendingAutoPlay = true;
    this.playbackIntent = true;
    this.startHealthMonitor();
    this.audio.play().catch((e) => log.warn('resume failed', e));
  }

  async togglePlayPause(): Promise<void> {
    if (this.audio.paused) {
      if (!this.audio.src) {
        this.resumeRestored();
        return;
      }
      this.pendingAutoPlay = true;
      this.playbackIntent = true;
      this.startHealthMonitor();
      await this.audio.play();
    } else {
      this.pause();
    }
  }

  private resumeRestored(): void {
    const { currentTrack } = usePlayerStore.getState();
    if (!currentTrack) return;
    const startAt = this.resumeAt ?? usePlayerStore.getState().savedPosition ?? 0;
    this.play(currentTrack, undefined, undefined, { startAt }).catch(() => {});
  }

  /**
   * Called once at startup: the queue and track come back from storage, but
   * nothing is loaded until the user presses play (no surprise audio).
   */
  restoreSession(): void {
    const { currentTrack, savedPosition } = usePlayerStore.getState();
    if (!currentTrack) return;
    this.resumeAt = savedPosition ?? 0;
    usePlayerStore.getState().setState('paused');
    usePlayerStore.getState().setPosition(this.resumeAt);
  }

  seek(position: number): void {
    try {
      const duration = this.audio.duration;
      if (duration && isFinite(position) && isFinite(duration)) {
        this.seekSuppressUntil = Date.now() + 2000;
        const newPosition = Math.max(0, Math.min(position, duration));
        // A seek while crossfading cancels the fade: keep the new track only
        if (this.outgoing) this.releaseOutgoing();
        if (this.cachedBlobForCurrentTrack && !this.audio.src.startsWith('blob:')) {
          this.swapToCachedBlob(newPosition);
          return;
        }
        this.audio.currentTime = newPosition;
        this.lastPositionUpdate = Date.now();
        this.updatePositionState();
      } else if (!this.audio.src && isFinite(position)) {
        // Restored but not loaded yet: remember where to start
        this.resumeAt = Math.max(0, position);
        usePlayerStore.getState().setPosition(this.resumeAt);
      }
    } catch (error) {
      console.error('Seek error:', error);
    }
  }

  seekPercent(percent: number): void {
    if (this.audio.duration) this.seek((percent / 100) * this.audio.duration);
  }

  private startHealthMonitor(): void {
    if (this.healthMonitor !== null) return;
    this.lastHealthPosition = -1;
    this.stallTicks = 0;
    this.healthMonitor = window.setInterval(() => this.healthCheck(), 3000);
  }

  private stopHealthMonitor(): void {
    if (this.healthMonitor !== null) {
      clearInterval(this.healthMonitor);
      this.healthMonitor = null;
    }
  }

  private healthCheck(): void {
    if (!this.playbackIntent) {
      this.stopHealthMonitor();
      return;
    }
    // The sleep timer must also fire if timeupdate is throttled
    this.handleSleepTimer();

    if (this.mixBus && this.audioContext && this.audioContext.state !== 'running') {
      this.audioContext.resume().catch(() => {});
    }

    const el = this.audio;
    const playing = !el.paused && !el.ended;
    if (!playing) {
      if (this.pendingAutoPlay && el.src) el.play().catch(() => {});
      return;
    }

    const pos = el.currentTime;
    if (pos === this.lastHealthPosition && el.src.startsWith('blob:')) {
      this.stallTicks++;
      if (this.stallTicks >= 3) {
        log.warn('Playback frozen, reloading source at', pos);
        this.stallTicks = 0;
        this.pendingAutoPlay = true;
        const src = el.src;
        el.addEventListener('loadedmetadata', () => {
          if (el.src !== src || el !== this.audio) return;
          el.currentTime = pos;
          el.play().catch(() => {});
        }, { once: true });
        el.load();
      }
    } else {
      this.stallTicks = 0;
    }
    this.lastHealthPosition = pos;
  }

  private clearSwapLoadedListener(): void {
    if (this.swapLoadedListener) {
      this.audio.removeEventListener('loadedmetadata', this.swapLoadedListener);
      this.swapLoadedListener = null;
    }
  }

  // Replace the network stream with the cached blob, keeping position/state
  private swapToCachedBlob(position: number): void {
    const blob = this.cachedBlobForCurrentTrack;
    if (!blob) return;
    const el = this.audio;
    const wasPlaying = !el.paused && !el.ended;

    this.clearSwapLoadedListener();
    this.revokeElementUrl(el);
    const blobUrl = URL.createObjectURL(blob);
    this.blobUrls.set(el, blobUrl);
    this.pendingAutoPlay = wasPlaying;
    // The source swap pauses the element: not a user pause
    this.transitioning = wasPlaying;

    const onLoaded = () => {
      this.clearSwapLoadedListener();
      el.currentTime = position;
      this.lastPositionUpdate = Date.now();
      this.updatePositionState();
      if (wasPlaying) {
        el.play().catch((e) => log.warn('play after blob swap failed', e));
      } else {
        usePlayerStore.getState().setState('paused');
      }
      this.refreshVisualizer();
    };
    this.swapLoadedListener = onLoaded;
    el.addEventListener('loadedmetadata', onLoaded);
    el.src = blobUrl;
    el.load();
  }

  async next(options: { auto?: boolean; crossfadeSeconds?: number } = {}): Promise<void> {
    const { queue } = usePlayerStore.getState();
    if (queue.length === 0) return;
    const nextIndex = this.peekNextIndex();
    if (nextIndex < 0) {
      // End of queue
      this.stop();
      return;
    }
    await this.playAtIndex(nextIndex, options);
  }

  async previous(): Promise<void> {
    const { queue, currentIndex, repeatMode } = usePlayerStore.getState();
    if (queue.length === 0) return;
    if (this.audio.currentTime > 3) {
      this.seek(0);
      return;
    }
    if (currentIndex > 0) {
      await this.playAtIndex(currentIndex - 1);
    } else if (repeatMode === 'all') {
      await this.playAtIndex(queue.length - 1);
    } else {
      this.seek(0);
    }
  }

  async skipToPrevious(): Promise<void> {
    const { queue, currentIndex, repeatMode } = usePlayerStore.getState();
    if (queue.length === 0) return;
    if (currentIndex > 0) {
      await this.playAtIndex(currentIndex - 1);
    } else if (repeatMode === 'all') {
      await this.playAtIndex(queue.length - 1);
    }
  }

  private async handleTrackEnd(): Promise<void> {
    const { repeatMode, sleepAtEndOfTrack } = usePlayerStore.getState();
    if (sleepAtEndOfTrack) {
      this.finishSleep();
      return;
    }
    if (repeatMode === 'one') {
      this.seek(0);
      this.pendingAutoPlay = true;
      await this.audio.play().catch((e) => log.warn('repeat-one play failed', e));
    } else {
      await this.next({ auto: true });
    }
  }

  // ---------------------------------------------------------------------------
  // Sleep timer
  // ---------------------------------------------------------------------------

  /** Pause after `minutes` (fading out), or at the end of the track with 'track'. */
  setSleepTimer(minutes: number | 'track'): void {
    const store = usePlayerStore.getState();
    if (minutes === 'track') {
      store.setSleepTimer(null, true);
    } else {
      store.setSleepTimer(Date.now() + minutes * 60_000, false);
    }
  }

  cancelSleepTimer(): void {
    usePlayerStore.getState().setSleepTimer(null, false);
    this.setLevel(this.audio, 1);
  }

  private handleSleepTimer(): void {
    const { sleepTimerEndsAt } = usePlayerStore.getState();
    if (!sleepTimerEndsAt) return;
    const remaining = (sleepTimerEndsAt - Date.now()) / 1000;
    if (remaining <= 0) {
      this.finishSleep();
    } else if (remaining <= SLEEP_FADE_SECONDS && !this.outgoing) {
      this.setLevel(this.audio, remaining / SLEEP_FADE_SECONDS);
    }
  }

  private finishSleep(): void {
    usePlayerStore.getState().setSleepTimer(null, false);
    this.pause();
    this.audio.loop = false;
    // Next play starts at full volume
    this.setLevel(this.audio, 1);
    useUiStore.getState().addToast(t('Sleep timer: playback paused'), 'info');
  }

  // ---------------------------------------------------------------------------
  // Session persistence
  // ---------------------------------------------------------------------------

  private persistPosition(force: boolean): void {
    const now = Date.now();
    if (!force && now - this.lastPersistAt < 5000) return;
    this.lastPersistAt = now;
    if (!this.audio.src) return;
    const position = this.audio.currentTime;
    if (Number.isFinite(position)) usePlayerStore.getState().setSavedPosition(position);
  }

  stop(): void {
    this.releaseOutgoing();
    for (const el of this.elements) this.releaseElement(el);
    this.lastTimeupdatePos = 0;
    this.cachedBlobForCurrentTrack = null;
    this.pendingAutoPlay = false;
    this.playbackIntent = false;
    this.transitioning = false;
    this.prepared = null;
    this.preparingFor = null;
    this.plannedNextIndex = null;
    this.stopHealthMonitor();
    this.clearSwapLoadedListener();
    playbackCache.cancel();
    this.lastBufferedKey = '';
    const store = usePlayerStore.getState();
    store.setBufferedRanges([]);
    store.setCachedPercent(0);
    store.setState('stopped');
    store.setSavedPosition(0);
    if (this.mediaSessionEnabled) navigator.mediaSession.playbackState = 'none';
  }

  async addToQueue(track: Track): Promise<void> {
    usePlayerStore.getState().addToQueue(track);
  }

  async addMultipleToQueue(tracks: Track[]): Promise<void> {
    usePlayerStore.getState().addMultipleToQueue(tracks);
  }

  clearQueue(): void {
    this.stop();
    usePlayerStore.getState().clearQueue();
  }

  get currentTime(): number {
    return this.audio.currentTime;
  }

  get duration(): number {
    return this.audio.duration || 0;
  }

  get isPlaying(): boolean {
    return !this.audio.paused && !this.audio.ended;
  }

  get isPaused(): boolean {
    return this.audio.paused;
  }
}

export const audioPlayer = new AudioPlayerService();
