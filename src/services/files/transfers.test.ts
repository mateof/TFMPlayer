import { describe, expect, it } from 'vitest';
import type { TransferDto, TransfersSnapshotDto } from '@/services/api/v1';
import { groupTransfers, hasFinished, transferActions } from './transfers';

const transfer = (over: Partial<TransferDto> = {}): TransferDto => ({
  id: 't1', kind: 'download', action: 'Download', state: 'Working', isQueued: false, name: 'a.mkv', path: null,
  channelId: '1', channelName: 'Ch', size: 10, transmitted: 5, sizeText: '10 B', transmittedText: '5 B', progress: 50,
  createdAt: '', startedAt: null, endedAt: null, totalItems: null, executedItems: null, isUpload: null, fromPath: null, toPath: null,
  ...over
});

const sorted = (s: Set<string>) => [...s].sort();

describe('transferActions', () => {
  it('pauses and cancels running downloads', () => {
    expect(sorted(transferActions(transfer(), true))).toEqual(['cancel', 'pause']);
    // Uploads can't be paused one by one
    expect(sorted(transferActions(transfer({ kind: 'upload' }), true))).toEqual(['cancel']);
  });

  it('resumes paused ones and retries failed downloads and tasks', () => {
    expect(sorted(transferActions(transfer({ state: 'Paused' }), true))).toEqual(['cancel', 'remove', 'resume']);
    expect(sorted(transferActions(transfer({ state: 'Error', kind: 'task' }), true))).toEqual(['remove', 'retry']);
    expect(sorted(transferActions(transfer({ state: 'Canceled', kind: 'upload' }), true))).toEqual(['remove']);
  });

  it('only removes from the list when the server supports it', () => {
    expect(sorted(transferActions(transfer({ state: 'Completed' }), true))).toEqual(['remove']);
    expect(sorted(transferActions(transfer({ state: 'Completed' }), false))).toEqual([]);
    expect(sorted(transferActions(transfer({ state: 'Pending' }), false))).toEqual(['cancel']);
  });
});

describe('groupTransfers', () => {
  it('merges running and queued lists without repeats and drops empty sections', () => {
    const snapshot = {
      downloads: [transfer({ id: 'a' })],
      queuedDownloads: [transfer({ id: 'b', state: 'Pending', isQueued: true }), transfer({ id: 'a' })],
      uploads: [],
      queuedUploads: [],
      tasks: [transfer({ id: 'c', kind: 'task', state: 'Completed' })],
      summary: {} as TransfersSnapshotDto['summary']
    } satisfies TransfersSnapshotDto;
    const groups = groupTransfers(snapshot);
    expect(groups.map((g) => [g.section, g.items.map((i) => i.id)])).toEqual([
      ['downloads', ['a', 'b']],
      ['tasks', ['c']]
    ]);
    expect(hasFinished(groups)).toBe(true);
    expect(hasFinished(groups.slice(0, 1))).toBe(false);
    expect(groupTransfers(undefined)).toEqual([]);
  });
});
