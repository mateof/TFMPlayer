import { useEffect, useRef, useState, useCallback } from 'react';
import { audioPlayer } from '@/services/audio/AudioPlayerService';

interface AudioEqualizerProps {
  isPlaying: boolean;
}

export function AudioEqualizer({ isPlaying }: AudioEqualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const [isRealVisualizer, setIsRealVisualizer] = useState(false);
  const [initAttempted, setInitAttempted] = useState(false);

  // Fallback animation state
  const fallbackBarsRef = useRef<number[]>([]);
  const fallbackTargetsRef = useRef<number[]>([]);
  const timeRef = useRef<number>(0);

  const BAR_COUNT = 31;

  // Standard ISO 31-band equalizer frequencies (Hz)
  const ISO_FREQUENCIES = [
    20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160,
    200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600,
    2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500, 16000, 20000
  ];

  // Initialize visualizer on mount
  useEffect(() => {
    if (initAttempted) return;
    setInitAttempted(true);

    // Initialize fallback bars
    fallbackBarsRef.current = Array(BAR_COUNT).fill(0);
    fallbackTargetsRef.current = Array(BAR_COUNT).fill(0);

    // Try to initialize real visualizer
    const analyser = audioPlayer.initVisualizer();
    if (analyser) {
      analyserRef.current = analyser;
      dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
      setIsRealVisualizer(true);
      audioPlayer.resumeAudioContext();
    }
  }, [initAttempted]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      animationRef.current = requestAnimationFrame(draw);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const barWidth = (width / BAR_COUNT) - 2;
    const barGap = 2;
    const maxBarHeight = height - 20;

    let barValues: number[] = [];

    if (isRealVisualizer && analyserRef.current && dataArrayRef.current && isPlaying) {
      // Real audio analysis
      const analyser = analyserRef.current;
      const dataArray = dataArrayRef.current;

      analyser.getByteFrequencyData(dataArray);

      const frequencyBinCount = analyser.frequencyBinCount;
      // Get actual sample rate from AudioContext, fallback to 44100
      const sampleRate = analyser.context?.sampleRate || 44100;
      const binWidth = sampleRate / (analyser.fftSize || 8192);

      // Each bar represents a specific ISO frequency
      for (let i = 0; i < BAR_COUNT; i++) {
        const centerFreq = ISO_FREQUENCIES[i];

        // Calculate the bin index for this frequency
        const binIndex = Math.round(centerFreq / binWidth);

        // Get value from the bin (and adjacent bins for smoothing)
        let value = 0;
        let count = 0;

        // For low frequencies, use fewer adjacent bins to avoid overlap
        // For high frequencies, use more for smoothing
        let range: number;
        if (centerFreq < 100) {
          range = 0; // Only center bin for sub-bass (20-80Hz)
        } else if (centerFreq < 500) {
          range = 1; // 1 adjacent bin for bass (100-400Hz)
        } else if (centerFreq < 2000) {
          range = 2; // 2 adjacent bins for mids
        } else {
          range = 3; // 3 adjacent bins for highs
        }

        for (let j = Math.max(0, binIndex - range); j <= Math.min(frequencyBinCount - 1, binIndex + range); j++) {
          // Weight center bin more heavily
          const distance = Math.abs(j - binIndex);
          const weight = distance === 0 ? 1.0 : 0.5;
          value += dataArray[j] * weight;
          count += weight;
        }

        value = count > 0 ? value / count : 0;

        // Normalize to 0-1
        let normalized = value / 255;

        // Apply frequency-dependent boost (higher frequencies have less energy)
        let boost = 1.0;
        if (centerFreq >= 8000) {
          boost = 2.5; // Very high frequencies
        } else if (centerFreq >= 4000) {
          boost = 2.0; // High frequencies
        } else if (centerFreq >= 2000) {
          boost = 1.6; // Upper mids
        } else if (centerFreq >= 1000) {
          boost = 1.3; // Mids
        } else if (centerFreq >= 500) {
          boost = 1.1; // Lower mids
        }

        normalized = normalized * boost;

        // Apply curve for better visual dynamics
        const curved = Math.pow(normalized, 0.7);

        barValues.push(Math.min(1, curved));
      }
    } else {
      // Fallback: animated bars when not playing or no real visualizer
      timeRef.current += 0.03;

      for (let i = 0; i < BAR_COUNT; i++) {
        if (isPlaying) {
          const normalizedIndex = i / BAR_COUNT;
          let baseAmplitude;

          if (normalizedIndex < 0.15) {
            baseAmplitude = 0.4 + Math.random() * 0.3;
          } else if (normalizedIndex < 0.4) {
            baseAmplitude = 0.5 + Math.random() * 0.4;
          } else if (normalizedIndex < 0.7) {
            baseAmplitude = 0.35 + Math.random() * 0.4;
          } else {
            baseAmplitude = 0.2 + Math.random() * 0.35;
          }

          fallbackTargetsRef.current[i] = baseAmplitude;
        } else {
          fallbackTargetsRef.current[i] = 0.02;
        }

        // Smooth interpolation
        fallbackBarsRef.current[i] += (fallbackTargetsRef.current[i] - fallbackBarsRef.current[i]) * 0.12;
        barValues.push(fallbackBarsRef.current[i]);
      }
    }

    // Draw bars
    for (let i = 0; i < BAR_COUNT; i++) {
      const value = Math.min(1, barValues[i] || 0);
      const barHeight = Math.max(3, value * maxBarHeight);
      const x = i * (barWidth + barGap) + barGap;
      const y = height - barHeight - 10;

      // Create gradient
      const gradient = ctx.createLinearGradient(x, y, x, height - 10);

      if (value > 0.65) {
        gradient.addColorStop(0, '#34d399'); // emerald-400
        gradient.addColorStop(0.6, '#10b981'); // emerald-500
        gradient.addColorStop(1, '#059669'); // emerald-600
      } else if (value > 0.35) {
        gradient.addColorStop(0, '#10b981'); // emerald-500
        gradient.addColorStop(1, '#047857'); // emerald-700
      } else {
        gradient.addColorStop(0, '#059669'); // emerald-600
        gradient.addColorStop(1, '#065f46'); // emerald-800
      }

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, [2, 2, 0, 0]);
      ctx.fill();
    }

    // Subtle reflection
    ctx.globalAlpha = 0.1;
    for (let i = 0; i < BAR_COUNT; i++) {
      const value = barValues[i] || 0;
      const reflectionHeight = Math.max(1, value * maxBarHeight * 0.2);
      const x = i * (barWidth + barGap) + barGap;
      const y = height - 8;

      ctx.fillStyle = '#10b981';
      ctx.fillRect(x, y, barWidth, reflectionHeight);
    }
    ctx.globalAlpha = 1;

    animationRef.current = requestAnimationFrame(draw);
  }, [isPlaying, isRealVisualizer]);

  useEffect(() => {
    animationRef.current = requestAnimationFrame(draw);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [draw]);

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
      <p className="text-xs text-slate-400 mt-2">
        {isRealVisualizer ? 'Audio Visualizer' : 'Visualizer'}
      </p>
    </div>
  );
}
