import { create } from 'zustand';
import { isApiError } from '@/services/api/v1';
import type { FileManagerTarget, FolderContext } from './fileManager';

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'canceled';

export interface UploadItem {
  id: string;
  name: string;
  size: number;
  /** Target key + location the file goes to (to refresh that listing when done). */
  targetKey: string;
  location: string;
  loaded: number;
  status: UploadStatus;
  error?: string;
}

interface UploadState {
  items: UploadItem[];
  update: (id: string, patch: Partial<UploadItem>) => void;
  add: (item: UploadItem) => void;
  clearFinished: () => void;
}

export const useUploadStore = create<UploadState>((set) => ({
  items: [],
  add: (item) => set((s) => ({ items: [...s.items, item] })),
  update: (id, patch) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) })),
  clearFinished: () => set((s) => ({ items: s.items.filter((i) => i.status === 'queued' || i.status === 'uploading') }))
}));

const controllers = new Map<string, AbortController>();
const pending: { id: string; run: () => Promise<void> }[] = [];
let running = 0;
// Two at a time: enough to keep the link busy without starving the player
const MAX_PARALLEL = 2;

let nextId = 0;

function pump() {
  while (running < MAX_PARALLEL && pending.length > 0) {
    const job = pending.shift()!;
    running++;
    job.run().finally(() => {
      running--;
      pump();
    });
  }
}

/**
 * Queues device files for upload to a target folder. `onDone` runs after each
 * successful upload (to refresh the listing).
 */
export function enqueueUploads(
  target: FileManagerTarget,
  ctx: FolderContext,
  files: File[],
  onDone?: (item: UploadItem) => void
): void {
  const store = useUploadStore.getState();
  for (const file of files) {
    const id = `up${++nextId}`;
    const item: UploadItem = {
      id,
      name: file.name,
      size: file.size,
      targetKey: target.key,
      location: ctx.location,
      loaded: 0,
      status: 'queued'
    };
    store.add(item);
    const controller = new AbortController();
    controllers.set(id, controller);
    pending.push({
      id,
      run: async () => {
        if (controller.signal.aborted) return;
        useUploadStore.getState().update(id, { status: 'uploading' });
        try {
          await target.upload(ctx, file, {
            signal: controller.signal,
            onProgress: (loaded) => useUploadStore.getState().update(id, { loaded })
          });
          useUploadStore.getState().update(id, { status: 'done', loaded: file.size });
          onDone?.({ ...item, status: 'done' });
        } catch (error) {
          if (isApiError(error) && error.isAborted) {
            useUploadStore.getState().update(id, { status: 'canceled' });
          } else {
            useUploadStore.getState().update(id, {
              status: 'error',
              error: error instanceof Error ? error.message : String(error)
            });
          }
        } finally {
          controllers.delete(id);
        }
      }
    });
  }
  pump();
}

/** Cancels a queued or running upload. */
export function cancelUpload(id: string): void {
  const controller = controllers.get(id);
  controller?.abort();
  const index = pending.findIndex((p) => p.id === id);
  if (index >= 0) {
    pending.splice(index, 1);
    controllers.delete(id);
    useUploadStore.getState().update(id, { status: 'canceled' });
  }
}

/** Test helper. */
export function __resetUploadsForTests(): void {
  pending.length = 0;
  controllers.clear();
  running = 0;
  useUploadStore.setState({ items: [] });
}
