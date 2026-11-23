import type { TransferDto, TransfersSnapshotDto } from '@/services/api/v1';

export type TransferAction = 'pause' | 'resume' | 'cancel' | 'retry' | 'remove';

export type TransferSection = 'downloads' | 'uploads' | 'tasks';

/**
 * What can be done with a server transfer in its current state. `canRemove`
 * says whether the server has `DELETE /api/v1/transfers/{id}`.
 */
export function transferActions(transfer: TransferDto, canRemove: boolean): Set<TransferAction> {
  const actions = new Set<TransferAction>();
  // Retry/resume exist for downloads and batch tasks, not single uploads
  const retryable = transfer.kind !== 'upload';
  switch (transfer.state) {
    case 'Working':
      if (transfer.kind === 'download') actions.add('pause');
      actions.add('cancel');
      break;
    case 'Pending':
      actions.add('cancel');
      if (canRemove) actions.add('remove');
      break;
    case 'Paused':
      if (retryable) actions.add('resume');
      actions.add('cancel');
      if (canRemove) actions.add('remove');
      break;
    case 'Error':
    case 'Canceled':
      if (retryable) actions.add('retry');
      if (canRemove) actions.add('remove');
      break;
    case 'Completed':
      if (canRemove) actions.add('remove');
      break;
  }
  return actions;
}

export interface TransferGroup {
  section: TransferSection;
  items: TransferDto[];
}

/** Snapshot -> three sections (running first, then the queue), without repeats. */
export function groupTransfers(snapshot: TransfersSnapshotDto | undefined): TransferGroup[] {
  if (!snapshot) return [];
  const unique = (lists: (TransferDto[] | undefined)[]) => {
    const seen = new Set<string>();
    const out: TransferDto[] = [];
    for (const list of lists) {
      for (const item of list ?? []) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
      }
    }
    return out;
  };
  return [
    { section: 'downloads' as const, items: unique([snapshot.downloads, snapshot.queuedDownloads]) },
    { section: 'uploads' as const, items: unique([snapshot.uploads, snapshot.queuedUploads]) },
    { section: 'tasks' as const, items: unique([snapshot.tasks]) }
  ].filter((g) => g.items.length > 0);
}

/** True when some entry is finished (there is something for "clear finished" to remove). */
export function hasFinished(groups: TransferGroup[]): boolean {
  return groups.some((g) => g.items.some((i) => i.state === 'Completed' || i.state === 'Error' || i.state === 'Canceled'));
}
