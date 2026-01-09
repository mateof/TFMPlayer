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

  const BAR_COUNT = 32;

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

      // Map frequency data to bars with logarithmic scale for better distribution
      const frequencyBinCount = analyser.frequencyBinCount;

      for (let i = 0; i < BAR_COUNT; i++) {
        // Use logarithmic scale to better represent human hearing
        const startPercent = i / BAR_COUNT;
        const endPercent = (i + 1) / BAR_COUNT;

        // Logarithmic mapping - more bins for lower frequencies
        const startIndex = Math.floor(Math.pow(startPercent, 1.5) * frequencyBinCount);
        const endIndex = Math.floor(Math.pow(endPercent, 1.5) * frequencyBinCount);

        // Average the values in this range
        let sum = 0;
        let count = 0;
        for (let j = startIndex; j < endIndex && j < frequencyBinCount; j++) {
          sum += dataArray[j];
          count++;
        }

        const average = count > 0 ? sum / count : 0;

        // Apply some scaling for visual appeal
        // Boost lower frequencies slightly, reduce high frequencies
        let scale = 1;
        if (i < BAR_COUNT * 0.2) scale = 1.1;
        else if (i > BAR_COUNT * 0.7) scale = 0.9;

        barValues.push((average / 255) * scale);
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
