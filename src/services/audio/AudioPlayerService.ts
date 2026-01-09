import { usePlayerStore } from '@/stores/playerStore';
import { db } from '@/db/database';
import { buildStreamUrlWithAuth, buildLocalStreamUrlWithAuth } from '@/services/api/client';
import type { Track } from '@/types/models';

class AudioPlayerService {
  private audio: HTMLAudioElement;
  private mediaSessionEnabled = 'mediaSession' in navigator;
  private currentBlobUrl: string | null = null;

  // Web Audio API for visualizer (lazy initialization)
  private audioContext: AudioContext | null = null;
  private analyserNode: AnalyserNode | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;

  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'metadata';
    this.setupEventListeners();
  }

  // Initialize Web Audio API for visualizer (called on user interaction)
  initVisualizer(): AnalyserNode | null {
    // Only create once
    if (this.analyserNode) {
      return this.analyserNode;
    }

    try {
      // Create audio context
      this.audioContext = new AudioContext();

      // Create analyser with good settings for visualization
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 128; // Smaller = less bars but more responsive
      this.analyserNode.smoothingTimeConstant = 0.7;
      this.analyserNode.minDecibels = -90;
      this.analyserNode.maxDecibels = -10;

      // Create source from audio element
      this.sourceNode = this.audioContext.createMediaElementSource(this.audio);

      // Connect: source -> analyser -> destination
      // This way audio still plays through speakers
      this.sourceNode.connect(this.analyserNode);
      this.analyserNode.connect(this.audioContext.destination);

      console.log('Visualizer initialized successfully');
      return this.analyserNode;
    } catch (error) {
      console.error('Failed to initialize visualizer:', error);
      return null;
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
      const currentState = store().state;
      if (currentState === 'loading' || currentState === 'buffering') {
        // Auto-play after loading
        this.audio.play().catch(console.error);
      }
    });

    this.audio.addEventListener('play', () => {
      store().setState('playing');
      this.updateMediaSession();
      // Update MediaSession playback state
      if (this.mediaSessionEnabled) {
        navigator.mediaSession.playbackState = 'playing';
      }
    });

    this.audio.addEventListener('pause', () => {
      if (!this.audio.ended) {
        store().setState('paused');
        // Update MediaSession playback state
        if (this.mediaSessionEnabled) {
          navigator.mediaSession.playbackState = 'paused';
        }
      }
    });

    this.audio.addEventListener('ended', () => {
      this.handleTrackEnd();
    });

    this.audio.addEventListener('timeupdate', () => {
      store().setPosition(this.audio.currentTime);
      // Update MediaSession position state for notification progress bar
      this.updatePositionState();
    });

    this.audio.addEventListener('waiting', () => {
      store().setState('buffering');
    });

    this.audio.addEventListener('playing', () => {
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
      const skipTime = details.seekOffset || 10;
      this.seek(Math.max(this.audio.currentTime - skipTime, 0));
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skipTime = details.seekOffset || 10;
      this.seek(Math.min(this.audio.currentTime + skipTime, this.audio.duration));
    });
  }

  private updateMediaSession() {
    if (!this.mediaSessionEnabled) return;

    const track = usePlayerStore.getState().currentTrack;
    if (!track) return;

    // Use BASE_URL for correct path on GitHub Pages
    const baseUrl = import.meta.env.BASE_URL || '/';
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || track.fileName,
      artist: track.artist || track.channelName,
      album: track.album || '',
      artwork: [
        { src: `${baseUrl}pwa-192x192.svg`, sizes: '192x192', type: 'image/svg+xml' },
        { src: `${baseUrl}pwa-512x512.svg`, sizes: '512x512', type: 'image/svg+xml' }
      ]
    });

    this.updatePositionState();
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

  private async getPlaybackUrl(track: Track): Promise<string> {
    // Check if track is cached in IndexedDB (for offline playback)
    try {
      const cached = await db.cachedTracks.get(track.fileId);
      if (cached?.blob) {
        console.log('Playing from cache:', track.fileName);
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

    try {
      // Stop current playback and cleanup old blob URL if any
      this.audio.pause();
      this.audio.currentTime = 0;
      this.revokeBlobUrl();

      // Get playback URL (cached blob or direct stream URL with apiKey)
      const url = await this.getPlaybackUrl(track);

      // Set new source and play
      this.audio.src = url;
      this.audio.volume = store.volume;

      await this.audio.play();
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
    this.audio.pause();
  }

  resume(): void {
    if (this.audio.src) {
      this.audio.play().catch(console.error);
    }
  }

  async togglePlayPause(): Promise<void> {
    if (this.audio.paused) {
      await this.audio.play();
    } else {
      this.audio.pause();
    }
  }

  seek(position: number): void {
    try {
      if (this.audio.duration && isFinite(position) && isFinite(this.audio.duration)) {
        const newPosition = Math.max(0, Math.min(position, this.audio.duration));
        console.log('Seeking to:', newPosition, 'of', this.audio.duration);
        this.audio.currentTime = newPosition;
        this.updatePositionState();
      }
    } catch (error) {
      console.error('Seek error:', error);
    }
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

  private async handleTrackEnd(): Promise<void> {
    const { repeatMode } = usePlayerStore.getState();

    if (repeatMode === 'one') {
      // Repeat current track
      this.seek(0);
      await this.audio.play();
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
