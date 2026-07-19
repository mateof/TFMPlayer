import { useEffect, useRef, useState } from 'react';
import { audioPlayer } from '@/services/audio/AudioPlayerService';

interface AudioEqualizerProps {
  isPlaying: boolean;
}

type VisualizerMode = 'bars' | 'mirror' | 'wave' | 'circle';

const MODES: { key: VisualizerMode; label: string }[] = [
  { key: 'bars', label: 'Bars' },
  { key: 'mirror', label: 'Mirror' },
  { key: 'wave', label: 'Wave' },
  { key: 'circle', label: 'Circle' }
];

const MODE_STORAGE_KEY = 'tfm-visualizer-mode';

const BAR_COUNT = 31;

// Standard ISO 31-band equalizer center frequencies (Hz)
const ISO_FREQUENCIES = [
  20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
  200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
  2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000
];

// Third-octave band edges: center / 2^(1/6) .. center * 2^(1/6)
const BAND_EDGE = Math.pow(2, 1 / 6);

// Peak-hold dynamics (per frame at ~60fps)
const ATTACK = 0.55;
const RELEASE = 0.10;
const PEAK_HOLD_FRAMES = 30;
const PEAK_FALL = 0.012;

function loadStoredMode(): VisualizerMode {
  try {
    const stored = localStorage.getItem(MODE_STORAGE_KEY);
    if (stored && MODES.some(m => m.key === stored)) return stored as VisualizerMode;
  } catch {
    // localStorage unavailable
  }
  return 'bars';
}

export function AudioEqualizer({ isPlaying }: AudioEqualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const freqDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const timeDataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const [isRealVisualizer, setIsRealVisualizer] = useState(false);
  const initAttemptedRef = useRef(false);
  const [mode, setMode] = useState<VisualizerMode>(loadStoredMode);
  const modeRef = useRef<VisualizerMode>(mode);

  // Per-bar dynamics state (levels follow the signal, peaks hold and fall)
  const levelsRef = useRef<number[]>(Array(BAR_COUNT).fill(0));
  const peaksRef = useRef<{ value: number; hold: number }[]>(
    Array.from({ length: BAR_COUNT }, () => ({ value: 0, hold: 0 }))
  );
  const timeRef = useRef<number>(0);

  const selectMode = (m: VisualizerMode) => {
    setMode(m);
    modeRef.current = m;
    try {
      localStorage.setItem(MODE_STORAGE_KEY, m);
    } catch {
      // localStorage unavailable
    }
  };

  // Initialize visualizer on mount
  useEffect(() => {
    if (initAttemptedRef.current) return;
    initAttemptedRef.current = true;

    const analyser = audioPlayer.initVisualizer();
    if (analyser) {
      analyserRef.current = analyser;
      freqDataRef.current = new Uint8Array(analyser.frequencyBinCount);
      timeDataRef.current = new Uint8Array(analyser.fftSize);
      audioPlayer.resumeAudioContext();
      // Async so the lint-discouraged sync-setState-in-effect is avoided
      queueMicrotask(() => setIsRealVisualizer(true));
    }
  }, []);

  // Animation loop
  useEffect(() => {
    let raf = 0;

    // Average the FFT bins covered by each third-octave band. The byte data
    // is already dB-mapped by the analyser, so averaging gives a realistic
    // analyzer-style reading; only a gentle high-frequency tilt is applied
    // to compensate music's natural spectral roll-off.
    const computeBands = (): number[] => {
      const analyser = analyserRef.current!;
      const data = freqDataRef.current!;
      analyser.getByteFrequencyData(data);

      const sampleRate = analyser.context?.sampleRate || 44100;
      const binWidth = sampleRate / analyser.fftSize;
      const maxBin = analyser.frequencyBinCount - 1;
      const bands: number[] = [];

      for (let i = 0; i < BAR_COUNT; i++) {
        const center = ISO_FREQUENCIES[i];
        const start = Math.min(maxBin, Math.max(1, Math.floor((center / BAND_EDGE) / binWidth)));
        const end = Math.min(maxBin, Math.max(start, Math.ceil((center * BAND_EDGE) / binWidth)));

        let sum = 0;
        for (let j = start; j <= end; j++) sum += data[j];
        let value = sum / (end - start + 1) / 255;

        // Gentle tilt above 1kHz (up to ~1.35x at 20kHz)
        if (center > 1000) {
          value *= 1 + Math.log2(center / 1000) * 0.08;
        }
        bands.push(Math.min(1, value));
      }
      return bands;
    };

    // Synthetic bands for the fallback animation (no analyser available)
    const computeFallbackBands = (): number[] => {
      const t = timeRef.current;
      const bands: number[] = [];
      for (let i = 0; i < BAR_COUNT; i++) {
        if (!isPlaying) {
          bands.push(0.02);
          continue;
        }
        const n = i / BAR_COUNT;
        const envelope = 0.55 - n * 0.3; // more energy in the lows
        const wobble =
          Math.sin(t * 2.1 + i * 0.9) * 0.18 +
          Math.sin(t * 3.7 + i * 0.35) * 0.12 +
          Math.random() * 0.12;
        bands.push(Math.max(0.03, Math.min(1, envelope + wobble)));
      }
      return bands;
    };

    // Apply attack/release and peak-hold dynamics to raw band values
    const applyDynamics = (bands: number[]) => {
      const levels = levelsRef.current;
      const peaks = peaksRef.current;
      for (let i = 0; i < BAR_COUNT; i++) {
        const target = bands[i];
        const rate = target > levels[i] ? ATTACK : RELEASE;
        levels[i] += (target - levels[i]) * rate;

        const peak = peaks[i];
        if (levels[i] >= peak.value) {
          peak.value = levels[i];
          peak.hold = PEAK_HOLD_FRAMES;
        } else if (peak.hold > 0) {
          peak.hold--;
        } else {
          peak.value = Math.max(levels[i], peak.value - PEAK_FALL);
        }
      }
    };

    const barGradient = (
      ctx: CanvasRenderingContext2D,
      x: number, yTop: number, yBottom: number, value: number
    ) => {
      const gradient = ctx.createLinearGradient(x, yTop, x, yBottom);
      if (value > 0.65) {
        gradient.addColorStop(0, '#34d399');
        gradient.addColorStop(0.6, '#10b981');
        gradient.addColorStop(1, '#059669');
      } else if (value > 0.35) {
        gradient.addColorStop(0, '#10b981');
        gradient.addColorStop(1, '#047857');
      } else {
        gradient.addColorStop(0, '#059669');
        gradient.addColorStop(1, '#065f46');
      }
      return gradient;
    };

    const drawBars = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const levels = levelsRef.current;
      const peaks = peaksRef.current;
      const barWidth = width / BAR_COUNT - 2;
      const barGap = 2;
      const maxBarHeight = height - 20;

      for (let i = 0; i < BAR_COUNT; i++) {
        const value = levels[i];
        const barHeight = Math.max(3, value * maxBarHeight);
        const x = i * (barWidth + barGap) + barGap;
        const y = height - barHeight - 10;

        ctx.fillStyle = barGradient(ctx, x, y, height - 10, value);
        ctx.beginPath();
        ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
        ctx.fill();

        // Peak-hold marker
        const peakY = height - 10 - Math.max(3, peaks[i].value * maxBarHeight);
        ctx.fillStyle = '#a7f3d0';
        ctx.fillRect(x, Math.max(2, peakY - 2), barWidth, 2);
      }

      // Subtle reflection
      ctx.globalAlpha = 0.1;
      for (let i = 0; i < BAR_COUNT; i++) {
        const x = i * (barWidth + barGap) + barGap;
        ctx.fillStyle = '#10b981';
        ctx.fillRect(x, height - 8, barWidth, Math.max(1, levels[i] * maxBarHeight * 0.2));
      }
      ctx.globalAlpha = 1;
    };

    const drawMirror = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const levels = levelsRef.current;
      const barWidth = width / BAR_COUNT - 2;
      const barGap = 2;
      const centerY = height / 2;
      const maxHalf = height / 2 - 12;

      for (let i = 0; i < BAR_COUNT; i++) {
        const value = levels[i];
        const half = Math.max(2, value * maxHalf);
        const x = i * (barWidth + barGap) + barGap;

        ctx.fillStyle = barGradient(ctx, x, centerY - half, centerY + half, value);
        ctx.beginPath();
        ctx.roundRect(x, centerY - half, barWidth, half * 2, 2);
        ctx.fill();
      }

      // Center line
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#a7f3d0';
      ctx.fillRect(0, centerY - 0.5, width, 1);
      ctx.globalAlpha = 1;
    };

    const drawWave = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const centerY = height / 2;
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#34d399';
      ctx.shadowColor = '#10b981';
      ctx.shadowBlur = 8;
      ctx.beginPath();

      if (isRealVisualizer && analyserRef.current && timeDataRef.current && isPlaying) {
        const data = timeDataRef.current;
        analyserRef.current.getByteTimeDomainData(data);
        const step = Math.max(1, Math.floor(data.length / width));
        for (let x = 0; x < width; x++) {
          const v = data[Math.min(data.length - 1, x * step)] / 128 - 1; // -1..1
          const y = centerY + v * (height / 2 - 8);
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      } else {
        // Synthetic idle/fallback wave
        const t = timeRef.current;
        const amplitude = isPlaying ? height * 0.22 : height * 0.03;
        for (let x = 0; x < width; x++) {
          const n = x / width;
          const y = centerY +
            Math.sin(n * Math.PI * 6 + t * 3) * amplitude * 0.7 +
            Math.sin(n * Math.PI * 14 + t * 5.3) * amplitude * 0.3;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
      }

      ctx.stroke();
      ctx.shadowBlur = 0;
    };

    const drawCircle = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
      const levels = levelsRef.current;
      const cx = width / 2;
      const cy = height / 2;
      const baseRadius = Math.min(width, height) * 0.22;
      const maxLength = Math.min(width, height) * 0.24;
      const rotation = timeRef.current * 0.15;

      // Bass-driven pulsing inner circle (average of the lowest bands)
      const bass = (levels[0] + levels[1] + levels[2] + levels[3]) / 4;
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius * (0.55 + bass * 0.25), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(16, 185, 129, 0.15)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx, cy, baseRadius - 4, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.35)';
      ctx.lineWidth = 1;
      ctx.stroke();

      // Two radial spokes per band for a denser ring
      const spokes = BAR_COUNT * 2;
      ctx.lineWidth = 3;
      ctx.lineCap = 'round';
      for (let s = 0; s < spokes; s++) {
        const value = levels[s % BAR_COUNT];
        const angle = (s / spokes) * Math.PI * 2 - Math.PI / 2 + rotation;
        const length = Math.max(2, value * maxLength);
        const x1 = cx + Math.cos(angle) * baseRadius;
        const y1 = cy + Math.sin(angle) * baseRadius;
        const x2 = cx + Math.cos(angle) * (baseRadius + length);
        const y2 = cy + Math.sin(angle) * (baseRadius + length);

        ctx.strokeStyle = value > 0.65 ? '#34d399' : value > 0.35 ? '#10b981' : '#047857';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
      }
    };

    const draw = () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        raf = requestAnimationFrame(draw);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      timeRef.current += 0.016;

      const currentMode = modeRef.current;
      if (currentMode !== 'wave') {
        const useReal = isRealVisualizer && analyserRef.current && freqDataRef.current && isPlaying;
        applyDynamics(useReal ? computeBands() : computeFallbackBands());
      }

      switch (currentMode) {
        case 'mirror':
          drawMirror(ctx, width, height);
          break;
        case 'wave':
          drawWave(ctx, width, height);
          break;
        case 'circle':
          drawCircle(ctx, width, height);
          break;
        default:
          drawBars(ctx, width, height);
      }

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, isRealVisualizer]);

  // Resize canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(dpr, dpr);
      }
    };

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    return () => window.removeEventListener('resize', resizeCanvas);
  }, []);

  return (
    <div className="w-full h-full flex flex-col items-center justify-center p-4">
      <canvas
        ref={canvasRef}
        className="w-full h-full"
        style={{ maxWidth: '100%', maxHeight: '100%' }}
      />
      {/* Mode selector: stopPropagation so taps don't flip the album card */}
      <div className="flex gap-1.5 mt-2" onClick={(e) => e.stopPropagation()}>
        {MODES.map((m) => (
          <button
            key={m.key}
            onClick={(e) => {
              e.stopPropagation();
              selectMode(m.key);
            }}
            className={`px-2.5 py-1 text-[10px] uppercase tracking-wide rounded-full transition-colors ${
              mode === m.key
                ? 'bg-emerald-500 text-white'
                : 'bg-slate-700/60 text-slate-300 hover:text-white'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
