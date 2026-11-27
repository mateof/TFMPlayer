import { describe, expect, it } from 'vitest';
import { replayGainFactor } from './replayGain';
import { isFinished } from '@/services/player/ResumeService';

describe('replayGainFactor', () => {
  it('turns loud tracks down', () => {
    expect(replayGainFactor({ db: -6 }, false)).toBeCloseTo(0.501, 2);
  });

  it('raises quiet tracks only through Web Audio, without clipping the peak', () => {
    expect(replayGainFactor({ db: 4 }, false)).toBe(1);
    expect(replayGainFactor({ db: 4 }, true)).toBeCloseTo(1.585, 2);
    expect(replayGainFactor({ db: 4, peak: 0.8 }, true)).toBeCloseTo(1.25, 2);
  });

  it('leaves untagged tracks alone', () => {
    expect(replayGainFactor(undefined, true)).toBe(1);
  });
});

describe('isFinished', () => {
  it('counts the last 15 seconds (or 2%) as the end', () => {
    expect(isFinished(3590, 3600)).toBe(true);
    expect(isFinished(3500, 3600)).toBe(false);
    expect(isFinished(7100, 7200)).toBe(true); // 2% of 2 h = 144 s
  });
});
