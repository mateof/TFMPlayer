import { useEffect, useRef, useCallback } from 'react';
import { audioPlayer } from '@/services/audio/AudioPlayerService';

interface AudioEqualizerProps {
  isPlaying: boolean;
}

export function AudioEqualizer({ isPlaying }: AudioEqualizerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>(0);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const analyser = analyserRef.current;

    if (!canvas || !analyser) {
      animationRef.current = requestAnimationFrame(draw);
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Calculate bar dimensions
    const barCount = 32; // Number of bars to display
    const barWidth = (canvas.width / barCount) - 2;
    const barGap = 2;
    const maxBarHeight = canvas.height - 20;

    // Sample data for the number of bars we want
    const step = Math.floor(bufferLength / barCount);

    for (let i = 0; i < barCount; i++) {
      // Get average of frequencies in this range
      let sum = 0;
      for (let j = 0; j < step; j++) {
        sum += dataArray[i * step + j];
      }
      const value = sum / step;

      // Calculate bar height (with minimum height when playing)
      const barHeight = Math.max(
        isPlaying ? 4 : 0,
        (value / 255) * maxBarHeight
      );

      const x = i * (barWidth + barGap) + barGap;
      const y = canvas.height - barHeight;

      // Create gradient for each bar
      const gradient = ctx.createLinearGradient(x, y, x, canvas.height);
      gradient.addColorStop(0, '#10b981'); // emerald-500
      gradient.addColorStop(0.5, '#34d399'); // emerald-400
      gradient.addColorStop(1, '#6ee7b7'); // emerald-300

      // Draw bar with rounded top
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, [4, 4, 0, 0]);
      ctx.fill();

      // Add glow effect for taller bars
      if (barHeight > maxBarHeight * 0.7) {
        ctx.shadowColor = '#10b981';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    animationRef.current = requestAnimationFrame(draw);
  }, [isPlaying]);

  useEffect(() => {
    // Get analyser node from audio player
    const analyser = audioPlayer.getAnalyserNode();
    analyserRef.current = analyser;

    // Resume audio context if needed
    audioPlayer.resumeAudioContext();

    // Start animation
    animationRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [draw]);

  // Resize canvas to match container
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const resizeCanvas = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * window.devicePixelRatio;
      canvas.height = rect.height * window.devicePixelRatio;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);
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
      <p className="text-xs text-slate-400 mt-2">Audio Visualizer</p>
    </div>
  );
}
