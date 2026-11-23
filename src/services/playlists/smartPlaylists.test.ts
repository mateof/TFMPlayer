import { describe, expect, it, vi } from 'vitest';

vi.mock('@/utils/collectTracks', () => ({
  collectChannelFolderTracks: vi.fn(),
  collectLocalFolderTracks: vi.fn()
}));

import { applySmartRules, DEFAULT_SMART_RULES, type SmartRules } from './smartPlaylists';
import type { Track } from '@/types/models';

const NOW = Date.parse('2026-11-23T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();

const track = (fileName: string, addedDaysAgo: number, filePath = '/'): Track => ({
  fileId: fileName,
  channelId: '1',
  channelName: 'Music',
  fileName,
  filePath,
  fileType: '',
  fileSize: 1,
  order: 0,
  dateAdded: daysAgo(addedDaysAgo),
  isLocalFile: false,
  streamUrl: ''
});

const rules = (partial: Partial<SmartRules>): SmartRules => ({ ...DEFAULT_SMART_RULES, ...partial });

const tracks = [
  track('b.flac', 3, '/Jazz'),
  track('a.mp3', 10, '/Rock'),
  track('c.FLAC', 40, '/Rock'),
  track('d.ogg', 1, '/Jazz/Live')
];

describe('applySmartRules', () => {
  it('filters by format (case-insensitive) and sorts by name', () => {
    const result = applySmartRules(tracks, rules({ formats: ['flac'] }), NOW);
    expect(result.map((r) => r.fileName)).toEqual(['b.flac', 'c.FLAC']);
  });

  it('matches text in the file name or its folder', () => {
    expect(applySmartRules(tracks, rules({ nameContains: 'jazz' }), NOW).map((r) => r.fileName)).toEqual(['b.flac', 'd.ogg']);
    expect(applySmartRules(tracks, rules({ nameContains: 'A.MP' }), NOW).map((r) => r.fileName)).toEqual(['a.mp3']);
  });

  it('keeps only recent additions and sorts newest first', () => {
    const result = applySmartRules(tracks, rules({ addedWithinDays: 30, sort: 'newest' }), NOW);
    expect(result.map((r) => r.fileName)).toEqual(['d.ogg', 'b.flac', 'a.mp3']);
  });

  it('combines rules, applies the limit and removes duplicates', () => {
    const withDupes = [...tracks, track('b.flac', 3, '/Jazz')];
    const result = applySmartRules(withDupes, rules({ formats: ['flac', 'ogg'], sort: 'oldest', limit: 2 }), NOW);
    expect(result.map((r) => r.fileName)).toEqual(['c.FLAC', 'b.flac']);
  });

  it('random order keeps every matching track', () => {
    const result = applySmartRules(tracks, rules({ sort: 'random' }), NOW);
    expect(result.map((r) => r.fileName).sort()).toEqual(['a.mp3', 'b.flac', 'c.FLAC', 'd.ogg']);
  });
});
