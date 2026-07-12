import type { BufferedRange } from '@/stores/playerStore';

// Merge the audio element's buffered ranges with the background auto-cache
// progress (which always downloads from the start) into non-overlapping
// segments, ready to render as "preloaded" highlights on a progress bar
export function getPreloadedRanges(
  buffered: BufferedRange[],
  cachedPercent: number,
  duration: number
): BufferedRange[] {
  if (!duration || duration <= 0) return [];

  const ranges = buffered.map((r) => ({ ...r }));
  if (cachedPercent > 0) {
    ranges.push({ start: 0, end: (Math.min(cachedPercent, 100) / 100) * duration });
  }

  ranges.sort((a, b) => a.start - b.start);

  const merged: BufferedRange[] = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    // Treat ranges closer than half a second as contiguous
    if (last && range.start <= last.end + 0.5) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push(range);
    }
  }
  return merged;
}
