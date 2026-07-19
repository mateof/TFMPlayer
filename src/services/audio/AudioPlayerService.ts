import { usePlayerStore } from '@/stores/playerStore';
import { db } from '@/db/database';
import { buildStreamUrlWithAuth, buildLocalStreamUrlWithAuth } from '@/services/api/client';
import { cacheService } from '@/services/cache/CacheService';
import { playbackCache } from '@/services/cache/PlaybackCacheService';
import { loadNextQueuePage } from '@/services/queue/QueueSourceService';
import { useSettingsStore, type SoundEnhancementSettings } from '@/stores/settingsStore';
import { EQ_BANDS } from '@/utils/eqPresets';
import type { Track } from '@/types/models';

// When this many (or fewer) tracks remain after the current one, page in more
const QUEUE_PREFETCH_THRESHOLD = 10;

class AudioPlayerService {
  private audio: HTMLAudioElement;
  private mediaSessionEnabled = 'mediaSession' in navigator;
  private currentBlobUrl: string | null = null;

  // Blob of the current track once it finishes auto-caching, so seeks can
  // switch to the local copy instead of re-downloading from the network
  private cachedBlobForCurrentTrack: Blob | null = null;
  private lastBufferedKey = '';

  // Explicit playback intent. True whenever playback should be running
  // (track started, auto-advance, resume) and false when the user paused.
  // canplay/visibilitychange re-issue play() while this is true, so a
  // rejected autoplay (background tab, autoplay policy, races) self-heals
  // instead of leaving the next track loaded but paused.
  private pendingAutoPlay = false;

  // Listener added by swapToCachedBlob; tracked so an interrupted swap
  // can't fire its stale callback on the next track's load
  private swapLoadedListener: (() => void) | null = null;

  // Periodic retry while playback should be running but isn't. Critical for
  // track transitions with the screen off: if the browser blocks play() or
  // suspends the AudioContext there, no event-based retry ever fires, the
  // audio stays silent and Android eventually kills the app.
  private autoPlayWatchdog: number | null = null;

  // Web Audio API for visualizer (lazy initialization)
  // Uses captureStream() to analyze audio WITHOUT affecting playback quality
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private streamSourceNode: MediaStreamAudioSourceNode | null = null;
  private visualizerInitialized = false;

  // Sound enhancement DSP chain (Web Audio). Once createMediaElementSource
  // is called the element's audio ALWAYS flows through the AudioContext, so
  // the graph is built lazily on first enable and bypassed when disabled.
  private mediaSource: MediaElementAudioSourceNode | null = null;
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

  // Cover art for MediaSession
  private currentCoverArt: string | null = null;

  // Throttle position updates to avoid MediaSession issues
  private lastPositionUpdate: number = 0;
  private positionUpdateInterval: number = 5000; // Update every 5 seconds

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    // Enable CORS for cross-origin audio (needed for visualizer)
    this.audio.crossOrigin = 'anonymous';
    this.setupEventListeners();

    // When the background cache finishes for the playing track, keep the blob
    // around so the next seek uses it instead of the network
    playbackCache.onCached((trackId, blob) => {
      const store = usePlayerStore.getState();
      if (store.currentTrack?.fileId === trackId) {
        this.cachedBlobForCurrentTrack = blob;
        store.setCachedPercent(100);
      }
    });

    // Expose background cache progress so the UI can highlight the preloaded part
    playbackCache.onProgress((trackId, percent) => {
      const store = usePlayerStore.getState();
      if (store.currentTrack?.fileId === trackId) {
        store.setCachedPercent(percent);
      }
    });
  }

  // Initialize Web Audio API for visualizer (called on user interaction)
  // Uses captureStream() - this does NOT affect audio quality as it creates a
  // separate analysis stream while the original audio plays unchanged
  initVisualizer(): AnalyserNode | null {
    // If already have an analyser, just resume context and return it
    if (this.analyserNode && this.audioContext) {
      this.resumeAudioContext();
      return this.analyserNode;
    }

    try {
      // Create (or reuse) the audio context shared with the DSP chain
      this.audioContext = this.ensureAudioContext();

      // Create analyser with good settings for visualization
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 8192; // Very high resolution for accurate low frequency bands (~5.4Hz per bin)
      this.analyserNode.smoothingTimeConstant = 0.7;
      this.analyserNode.minDecibels = -90;
      this.analyserNode.maxDecibels = -10;

      this.visualizerInitialized = true;

      // Connect to current stream if audio is playing
      this.connectVisualizerStream();

      console.log('Visualizer initialized with captureStream (audio quality unaffected)');
      return this.analyserNode;
    } catch (error) {
      console.error('Failed to initialize visualizer:', error);
      return null;
    }
  }

  // Connect visualizer to current audio stream using captureStream()
  // This creates a copy of the audio for analysis without affecting playback
  private connectVisualizerStream(): void {
    if (!this.audioContext || !this.analyserNode) return;

    // With the DSP graph active, the element no longer outputs through
    // captureStream: feed the analyser directly from the graph instead
    if (this.mediaSource) {
      this.applyDspRouting(this.dspEnabled);
      return;
    }

    try {
      // Disconnect previous source if any
      if (this.streamSourceNode) {
        this.streamSourceNode.disconnect();
        this.streamSourceNode = null;
      }

      // Use captureStream to get a MediaStream from the audio element
      // This does NOT route audio through Web Audio API - it creates a separate stream for analysis
      const audioElement = this.audio as HTMLAudioElement & { captureStream?: () => MediaStream };
      if (audioElement.captureStream) {
        const stream = audioElement.captureStream();
        if (stream.getAudioTracks().length > 0) {
          this.streamSourceNode = this.audioContext.createMediaStreamSource(stream);
          // Only connect to analyser, NOT to destination (we don't want to hear it twice)
          this.streamSourceNode.connect(this.analyserNode);
          console.log('Visualizer connected via captureStream');
        }
      }
    } catch (error) {
      console.warn('Could not connect visualizer stream:', error);
    }
  }

  // Called when track changes to refresh visualizer connection
  refreshVisualizer(): void {
    // With captureStream, we need to reconnect when the track changes
    // because the stream changes with the audio source
    this.resumeAudioContext();

    // Reconnect after a small delay to ensure the new audio source is ready
    if (this.visualizerInitialized) {
      setTimeout(() => {
        this.connectVisualizerStream();
      }, 100);
    }
  }

  // Get analyser node (returns null if not initialized)
  getAnalyserNode(): AnalyserNode | null {
    return this.analyserNode;
  }

  // Resume audio context if suspended
  async resumeAudioContext(): Promise<void> {
    if (this.audioContext?.state === 'suspended') {
      await this.audioContext.resume();
    }
  }

  private revokeBlobUrl(): void {
    if (this.currentBlobUrl) {
      URL.revokeObjectURL(this.currentBlobUrl);
      this.currentBlobUrl = null;
    }
  }

  private ensureAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext();

      // If the OS suspends the context while audio should be flowing through
      // the DSP graph (screen off, focus changes), resume it right away —
      // otherwise playback continues silently and Android ends up killing
      // the app for being inaudible
      this.audioContext.addEventListener('statechange', () => {
        if (
          this.audioContext &&
          this.audioContext.state !== 'running' &&
          this.mediaSource &&
          !this.audio.paused
        ) {
          this.audioContext.resume().catch(() => {});
        }
      });
    }
    return this.audioContext;
  }

  // Build the DSP graph once: source → EQ (10 bands) → bass boost →
  // stereo widener (mid/side) → compressor → makeup gain → destination
  private buildDspGraph(): boolean {
    try {
      const ctx = this.ensureAudioContext();

      if (!this.mediaSource) {
        this.mediaSource = ctx.createMediaElementSource(this.audio);
        // From now on the element only sounds through the graph: route it
        this.mediaSource.connect(ctx.destination);
      }
      if (this.chainInput && this.chainOutput) return true;

      this.chainInput = ctx.createGain();

      // 10-band EQ: shelves at the extremes, peaking in between
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

      // Dedicated bass boost below 80Hz
      this.bassFilter = ctx.createBiquadFilter();
      this.bassFilter.type = 'lowshelf';
      this.bassFilter.frequency.value = 80;
      this.bassFilter.gain.value = 0;
      node.connect(this.bassFilter);

      // Stereo widener: decompose into mid (L+R) and side (L-R), then
      // recombine with the side channel amplified for extra width
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

      // Volume leveling compressor: only wired into the path when the
      // loudness setting is on (see applySoundSettings)
      this.compressor = ctx.createDynamicsCompressor();
      this.compressor.threshold.value = -24;
      this.compressor.knee.value = 20;
      this.compressor.ratio.value = 2.5;
      this.compressor.attack.value = 0.003;
      this.compressor.release.value = 0.25;
      this.makeupGain = ctx.createGain();

      // Safety limiter: always last, prevents clipping distortion when
      // EQ/bass boosts push an already-loud master over full scale
      this.limiter = ctx.createDynamicsCompressor();
      this.limiter.threshold.value = -1.5;
      this.limiter.knee.value = 0;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.001;
      this.limiter.release.value = 0.1;

      // Default path (loudness off): merger → makeup → limiter
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

  // Route the media source through the DSP chain or straight to the output
  private applyDspRouting(enabled: boolean): void {
    if (!this.mediaSource || !this.audioContext || !this.chainInput || !this.chainOutput) return;

    this.mediaSource.disconnect();
    this.chainOutput.disconnect();

    const tail = enabled ? this.chainOutput : this.mediaSource;
    if (enabled) {
      this.mediaSource.connect(this.chainInput);
    }
    tail.connect(this.audioContext.destination);
    if (this.analyserNode) {
      // Tap (not in series): feeds the visualizer from the audible signal
      tail.connect(this.analyserNode);
    }
    this.dspEnabled = enabled;
  }

  // Apply sound enhancement settings, building the graph on first enable.
  // Safe to call on every slider change: parameters update live.
  applySoundSettings(sound: SoundEnhancementSettings): void {
    if (sound.enabled) {
      if (!this.buildDspGraph()) return;
      this.resumeAudioContext();

      this.eqFilters.forEach((filter, i) => {
        filter.gain.value = sound.eqGains[i] ?? 0;
      });
      this.bassFilter!.gain.value = sound.bassBoost;
      this.sideGain!.gain.value = 1 + sound.stereoWidth / 100;

      // Loudness: route through the compressor with auto-makeup so the net
      // level stays comparable on loud masters and quiet tracks get lifted.
      // makeup ≈ |threshold| · (1 − 1/ratio) / 2 = 24 · 0.6 / 2 ≈ +7dB
      this.mergerNode!.disconnect();
      if (sound.loudness) {
        this.mergerNode!.connect(this.compressor!);
        this.makeupGain!.gain.value = Math.pow(10, 7 / 20);
      } else {
        this.mergerNode!.connect(this.makeupGain!);
        this.makeupGain!.gain.value = 1;
      }

      this.applyDspRouting(true);
    } else if (this.mediaSource) {
      this.applyDspRouting(false);
    }
    // Never enabled and disabled: nothing was ever routed, nothing to do
  }

  private setupEventListeners() {
    const store = usePlayerStore.getState;

    this.audio.addEventListener('loadstart', () => {
      store().setState('loading');
    });

    this.audio.addEventListener('loadedmetadata', () => {
      const duration = this.audio.duration;
      if (Number.isFinite(duration) && duration > 0) {
        store().setDuration(duration);
        this.updatePositionState();
      }
    });

    this.audio.addEventListener('durationchange', () => {
      const duration = this.audio.duration;
      if (Number.isFinite(duration) && duration > 0) {
        store().setDuration(duration);
        this.updatePositionState();
      }
    });

    this.audio.addEventListener('canplay', () => {
      // Start/resume playback whenever it should be running but isn't
      if (this.pendingAutoPlay && this.audio.paused) {
        this.audio.play().catch(console.error);
      }
    });

    // If autoplay was blocked while the tab was hidden (e.g. auto-advance
    // with the screen off), retry as soon as the tab becomes visible
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && this.pendingAutoPlay && this.audio.paused && this.audio.src) {
        this.audio.play().catch(console.error);
      }
    });

    this.audio.addEventListener('play', () => {
      store().setState('playing');
      this.updateMediaSession();
      // Update MediaSession playback state
      if (this.mediaSessionEnabled) {
        navigator.mediaSession.playbackState = 'playing';
        // Reset throttle timer and update position after a small delay to ensure currentTime is accurate
        this.lastPositionUpdate = Date.now();
        setTimeout(() => {
          this.updatePositionState();
        }, 150);
      }
    });

    this.audio.addEventListener('pause', () => {
      if (!this.audio.ended) {
        store().setState('paused');
        // Update MediaSession playback state and position
        if (this.mediaSessionEnabled) {
          navigator.mediaSession.playbackState = 'paused';
          this.updatePositionState();
        }
      }
    });

    this.audio.addEventListener('ended', () => {
      this.handleTrackEnd();
    });

    this.audio.addEventListener('timeupdate', () => {
      store().setPosition(this.audio.currentTime);
      this.updateBufferedRanges();
      // Throttle MediaSession position updates to avoid issues
      // The browser extrapolates position between updates
      const now = Date.now();
      if (now - this.lastPositionUpdate >= this.positionUpdateInterval) {
        this.lastPositionUpdate = now;
        this.updatePositionState();
      }
    });

    // Fired while the browser downloads the stream: keep buffered ranges fresh
    this.audio.addEventListener('progress', () => {
      this.updateBufferedRanges();
    });

    this.audio.addEventListener('waiting', () => {
      store().setState('buffering');
    });

    this.audio.addEventListener('playing', () => {
      this.pendingAutoPlay = false;
      this.stopAutoPlayWatchdog();
      store().setState('playing');
    });

    this.audio.addEventListener('error', (e) => {
      const error = this.audio.error;
      console.error('Audio error:', {
        event: e,
        code: error?.code,
        message: error?.message,
        currentTime: this.audio.currentTime,
        duration: this.audio.duration,
        src: this.audio.src?.substring(0, 100)
      });
      store().setState('error');
      store().setError(error?.message || 'Playback error');
    });

    // Handle stalled/suspended playback
    this.audio.addEventListener('stalled', () => {
      console.warn('Audio stalled - network issue or slow connection');
    });

    this.audio.addEventListener('suspend', () => {
      console.log('Audio suspended - browser paused loading');
    });

    this.audio.addEventListener('volumechange', () => {
      store().setVolume(this.audio.volume);
    });

    // Setup MediaSession handlers
    if (this.mediaSessionEnabled) {
      this.setupMediaSession();
    }
  }

  private setupMediaSession() {
    navigator.mediaSession.setActionHandler('play', () => this.resume());
    navigator.mediaSession.setActionHandler('pause', () => this.pause());
    navigator.mediaSession.setActionHandler('previoustrack', () => this.previous());
    navigator.mediaSession.setActionHandler('nexttrack', () => this.next());
    navigator.mediaSession.setActionHandler('seekto', (details) => {
      if (details.seekTime !== undefined) {
        this.seek(details.seekTime);
      }
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const skipTime = details.seekOffset || useSettingsStore.getState().skipBackSeconds || 10;
      this.seek(Math.max(this.audio.currentTime - skipTime, 0));
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skipTime = details.seekOffset || useSettingsStore.getState().skipForwardSeconds || 10;
      this.seek(Math.min(this.audio.currentTime + skipTime, this.audio.duration));
    });
  }

  private updateMediaSession() {
    if (!this.mediaSessionEnabled) return;

    const track = usePlayerStore.getState().currentTrack;
    if (!track) return;

    // Use BASE_URL for correct path on GitHub Pages
    const baseUrl = import.meta.env.BASE_URL || '/';

    // Build artwork array - use cover art if available, otherwise fallback to PWA icons
    const artwork: MediaImage[] = this.currentCoverArt
      ? [{ src: this.currentCoverArt, sizes: '512x512', type: 'image/jpeg' }]
      : [
          { src: `${baseUrl}pwa-192x192.svg`, sizes: '192x192', type: 'image/svg+xml' },
          { src: `${baseUrl}pwa-512x512.svg`, sizes: '512x512', type: 'image/svg+xml' }
        ];

    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || track.fileName,
      artist: track.artist || track.channelName,
      album: track.album || '',
      artwork
    });

    this.updatePositionState();
  }

  // Update cover art for MediaSession (called asynchronously when metadata loads)
  updateCoverArt(coverArtDataUrl: string | null): void {
    this.currentCoverArt = coverArtDataUrl;
    // Refresh MediaSession with new artwork
    if (this.mediaSessionEnabled && coverArtDataUrl) {
      const track = usePlayerStore.getState().currentTrack;
      if (track) {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: track.title || track.fileName,
          artist: track.artist || track.channelName,
          album: track.album || '',
          artwork: [{ src: coverArtDataUrl, sizes: '512x512', type: 'image/jpeg' }]
        });
      }
    }
  }

  private updatePositionState() {
    if (!this.mediaSessionEnabled) return;

    const duration = this.audio.duration;
    const position = this.audio.currentTime;
    const playbackRate = this.audio.playbackRate;

    // Only update if we have valid finite values
    if (!Number.isFinite(duration) || duration <= 0 || duration > 86400) return;
    if (!Number.isFinite(position) || position < 0) return;

    // Ensure position doesn't exceed duration
    const safePosition = Math.min(Math.max(0, position), duration);

    try {
      navigator.mediaSession.setPositionState({
        duration: duration,
        playbackRate: playbackRate || 1,
        position: safePosition
      });
    } catch {
      // Ignore errors (some browsers don't support this)
    }
  }

  // Force update position state (call after seek or play)
  forceUpdatePositionState(): void {
    this.updatePositionState();
  }

  // Publish the audio element's buffered ranges to the store (skips the
  // update when nothing changed to avoid needless re-renders)
  private updateBufferedRanges(): void {
    const buffered = this.audio.buffered;
    const ranges: { start: number; end: number }[] = [];
    for (let i = 0; i < buffered.length; i++) {
      ranges.push({ start: buffered.start(i), end: buffered.end(i) });
    }

    const key = ranges.map(r => `${r.start.toFixed(1)}-${r.end.toFixed(1)}`).join(',');
    if (key === this.lastBufferedKey) return;
    this.lastBufferedKey = key;

    usePlayerStore.getState().setBufferedRanges(ranges);
  }

  private async getPlaybackUrl(track: Track): Promise<string> {
    // Check if track is cached in IndexedDB (for offline playback)
    try {
      const cached = await db.cachedTracks.get(track.fileId);
      if (cached?.blob) {
        console.log('Playing from cache:', track.fileName);
        this.cachedBlobForCurrentTrack = cached.blob;
        const blobUrl = URL.createObjectURL(cached.blob);
        this.currentBlobUrl = blobUrl;
        return blobUrl;
      }
    } catch (e) {
      console.warn('Error checking cache:', e);
    }

    // Build direct stream URL with apiKey for native browser streaming
    // This allows the browser to handle Range requests natively (instant playback + seeking)
    let url: string;
    if (track.isLocalFile) {
      url = await buildLocalStreamUrlWithAuth(track.filePath);
    } else {
      url = await buildStreamUrlWithAuth(track.channelId, track.fileId, track.fileName);
    }

    console.log('Streaming audio:', track.fileName, 'URL:', url.replace(/apiKey=[^&]+/, 'apiKey=***'));
    return url;
  }

  async play(track: Track, queue?: Track[], startIndex?: number): Promise<void> {
    const store = usePlayerStore.getState();

    // Set queue if provided
    if (queue && queue.length > 0) {
      store.setQueue(queue);
      store.setCurrentIndex(startIndex ?? 0);
    }

    // Set current track
    store.setCurrentTrack(track);
    store.setState('loading');

    // Clear previous cover art for new track
    this.currentCoverArt = null;

    try {
      // Stop current playback and cleanup old blob URL if any
      this.audio.pause();
      this.audio.currentTime = 0;
      this.revokeBlobUrl();
      this.clearSwapLoadedListener();
      this.cachedBlobForCurrentTrack = null;
      this.lastBufferedKey = '';
      store.setBufferedRanges([]);

      // Get playback URL (cached blob or direct stream URL with apiKey)
      const url = await this.getPlaybackUrl(track);

      // Cached tracks are fully available from the start
      store.setCachedPercent(this.currentBlobUrl ? 100 : 0);

      // Set new source and play. pendingAutoPlay makes canplay/visibility
      // retry the play() if this first attempt is rejected (autoplay policy,
      // background tab) so auto-advance never leaves the track paused.
      this.pendingAutoPlay = true;
      this.audio.src = url;
      this.audio.volume = store.volume;

      // Ensure the sound enhancement chain matches settings before playing
      const { sound } = useSettingsStore.getState();
      if (sound.enabled && !this.dspEnabled) {
        this.applySoundSettings(sound);
      } else if (this.mediaSource) {
        this.resumeAudioContext();
      }

      try {
        await this.audio.play();
      } catch (playError) {
        if (playError instanceof DOMException && playError.name === 'NotAllowedError') {
          // Autoplay blocked: keep the intent, the retry hooks will resume
          console.warn('Autoplay blocked, will retry on canplay/visibility');
        } else {
          throw playError;
        }
      }

      // Keep retrying in the background (screen off, throttled tab) until
      // playback actually starts
      this.startAutoPlayWatchdog();

      // Refresh visualizer connection for new track
      this.refreshVisualizer();

      // Keep LRU eviction data fresh (no-op if the track isn't cached)
      cacheService.updateLastPlayed(track.fileId).catch(() => {});

      // If streaming from the network, cache the full track in the background
      // so seeks and replays reuse the local copy
      if (!this.currentBlobUrl) {
        playbackCache.cacheTrackInBackground(track).catch(() => {});
      }

      // If the queue comes from a paginated source and we're near its end,
      // load the next page so the upcoming tracks are known
      const { queue: currentQueue, currentIndex, queueSource } = usePlayerStore.getState();
      if (queueSource?.hasMore &&
          currentQueue.length - 1 - currentIndex <= QUEUE_PREFETCH_THRESHOLD) {
        loadNextQueuePage().catch((e) => console.warn('Queue prefetch failed:', e));
      }
    } catch (error) {
      console.error('Playback error:', error);
      store.setState('error');
      store.setError('Failed to play track');
    }
  }

  async playAtIndex(index: number): Promise<void> {
    const store = usePlayerStore.getState();
    const { queue } = store;

    if (index >= 0 && index < queue.length) {
      store.setCurrentIndex(index);
      await this.play(queue[index]);
    }
  }

  pause(): void {
    this.pendingAutoPlay = false;
    this.stopAutoPlayWatchdog();
    this.audio.pause();
  }

  resume(): void {
    if (this.audio.src) {
      this.pendingAutoPlay = true;
      this.audio.play().catch(console.error);
    }
  }

  async togglePlayPause(): Promise<void> {
    if (this.audio.paused) {
      this.pendingAutoPlay = true;
      await this.audio.play();
    } else {
      this.pendingAutoPlay = false;
      this.audio.pause();
    }
  }

  seek(position: number): void {
    try {
      if (this.audio.duration && isFinite(position) && isFinite(this.audio.duration)) {
        const newPosition = Math.max(0, Math.min(position, this.audio.duration));
        console.log('Seeking to:', newPosition, 'of', this.audio.duration);

        // If the track finished caching while streaming, switch to the local
        // blob so this (and any further) seek doesn't hit the network
        if (this.cachedBlobForCurrentTrack && !this.audio.src.startsWith('blob:')) {
          this.swapToCachedBlob(newPosition);
          return;
        }

        this.audio.currentTime = newPosition;
        // Reset throttle timer and update position immediately after seek
        this.lastPositionUpdate = Date.now();
        this.updatePositionState();
      }
    } catch (error) {
      console.error('Seek error:', error);
    }
  }

  private startAutoPlayWatchdog(): void {
    this.stopAutoPlayWatchdog();
    let attempts = 0;
    this.autoPlayWatchdog = window.setInterval(() => {
      const playbackRunning = !this.audio.paused && !this.audio.ended;
      if (!this.pendingAutoPlay || playbackRunning || attempts >= 15) {
        this.stopAutoPlayWatchdog();
        return;
      }
      attempts++;
      this.resumeAudioContext();
      this.audio.play().catch(() => {});
    }, 2000);
  }

  private stopAutoPlayWatchdog(): void {
    if (this.autoPlayWatchdog !== null) {
      clearInterval(this.autoPlayWatchdog);
      this.autoPlayWatchdog = null;
    }
  }

  private clearSwapLoadedListener(): void {
    if (this.swapLoadedListener) {
      this.audio.removeEventListener('loadedmetadata', this.swapLoadedListener);
      this.swapLoadedListener = null;
    }
  }

  // Replace the network stream source with the cached blob, preserving
  // position and play/pause state
  private swapToCachedBlob(position: number): void {
    const blob = this.cachedBlobForCurrentTrack;
    if (!blob) return;

    const wasPlaying = !this.audio.paused && !this.audio.ended;
    console.log('Switching to cached blob for local seeking');

    this.revokeBlobUrl();
    this.clearSwapLoadedListener();
    const blobUrl = URL.createObjectURL(blob);
    this.currentBlobUrl = blobUrl;
    this.pendingAutoPlay = wasPlaying;

    const onLoaded = () => {
      this.clearSwapLoadedListener();
      this.audio.currentTime = position;
      this.lastPositionUpdate = Date.now();
      this.updatePositionState();
      if (wasPlaying) {
        this.audio.play().catch(console.error);
      } else {
        usePlayerStore.getState().setState('paused');
      }
      this.refreshVisualizer();
    };
    this.swapLoadedListener = onLoaded;
    this.audio.addEventListener('loadedmetadata', onLoaded);
    this.audio.src = blobUrl;
    this.audio.load();
  }

  seekPercent(percent: number): void {
    if (this.audio.duration) {
      this.seek((percent / 100) * this.audio.duration);
    }
  }

  setVolume(volume: number): void {
    this.audio.volume = Math.max(0, Math.min(1, volume));
  }

  async next(): Promise<void> {
    const store = usePlayerStore.getState();
    const { queue, currentIndex, shuffle, repeatMode } = store;

    if (queue.length === 0) return;

    let nextIndex: number;

    if (shuffle) {
      // Pick random track (excluding current)
      const availableIndices = queue
        .map((_, i) => i)
        .filter(i => i !== currentIndex);
      if (availableIndices.length > 0) {
        nextIndex = availableIndices[Math.floor(Math.random() * availableIndices.length)];
      } else {
        nextIndex = currentIndex;
      }
    } else if (currentIndex < queue.length - 1) {
      nextIndex = currentIndex + 1;
    } else if (repeatMode === 'all') {
      nextIndex = 0;
    } else {
      // End of queue, stop
      this.stop();
      return;
    }

    await this.playAtIndex(nextIndex);
  }

  async previous(): Promise<void> {
    const store = usePlayerStore.getState();
    const { queue, currentIndex, repeatMode } = store;

    if (queue.length === 0) return;

    // If more than 3 seconds into track, restart it
    if (this.audio.currentTime > 3) {
      this.seek(0);
      return;
    }

    let prevIndex: number;

    if (currentIndex > 0) {
      prevIndex = currentIndex - 1;
    } else if (repeatMode === 'all') {
      prevIndex = queue.length - 1;
    } else {
      // Beginning of queue, restart track
      this.seek(0);
      return;
    }

    await this.playAtIndex(prevIndex);
  }

  // Skip to previous track without checking time (for swipe gestures)
  async skipToPrevious(): Promise<void> {
    const store = usePlayerStore.getState();
    const { queue, currentIndex, repeatMode } = store;

    if (queue.length === 0) return;

    let prevIndex: number;

    if (currentIndex > 0) {
      prevIndex = currentIndex - 1;
    } else if (repeatMode === 'all') {
      prevIndex = queue.length - 1;
    } else {
      // Beginning of queue, do nothing or go to last if repeat all
      return;
    }

    await this.playAtIndex(prevIndex);
  }

  private async handleTrackEnd(): Promise<void> {
    const { repeatMode } = usePlayerStore.getState();

    if (repeatMode === 'one') {
      // Repeat current track. Intent set after seek(0): a seek at 'ended'
      // can swap to the cached blob, which would overwrite it with "paused"
      this.seek(0);
      this.pendingAutoPlay = true;
      await this.audio.play().catch(console.error);
    } else {
      // Go to next track
      await this.next();
    }
  }

  stop(): void {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.audio.src = '';
    this.revokeBlobUrl();
    this.cachedBlobForCurrentTrack = null;
    this.pendingAutoPlay = false;
    this.stopAutoPlayWatchdog();
    this.clearSwapLoadedListener();
    playbackCache.cancel();
    this.lastBufferedKey = '';
    usePlayerStore.getState().setBufferedRanges([]);
    usePlayerStore.getState().setCachedPercent(0);
    usePlayerStore.getState().setState('stopped');
    // Update MediaSession playback state
    if (this.mediaSessionEnabled) {
      navigator.mediaSession.playbackState = 'none';
    }
  }

  // Queue management
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

  // Get current state
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

// Singleton instance
export const audioPlayer = new AudioPlayerService();
