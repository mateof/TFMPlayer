import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/v1';
import { __resetUploadsForTests, cancelUpload, enqueueUploads, useUploadStore } from './uploadQueue';
import type { FileManagerTarget } from './fileManager';

function fakeTarget(upload: FileManagerTarget['upload']): FileManagerTarget {
  return { key: 'local', kind: 'local', upload } as unknown as FileManagerTarget;
}

const file = (name: string, size = 4) => new File(['x'.repeat(size)], name);
const flush = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => __resetUploadsForTests());

describe('upload queue', () => {
  it('uploads with progress and refreshes when done', async () => {
    const onDone = vi.fn();
    const target = fakeTarget(async (_ctx, _file, options) => {
      options.onProgress?.(2, 4);
      expect(useUploadStore.getState().items[0]).toMatchObject({ status: 'uploading', loaded: 2 });
    });
    enqueueUploads(target, { location: 'music', currentPath: 'music' }, [file('a.mp3')], onDone);
    await flush();
    expect(useUploadStore.getState().items[0]).toMatchObject({ name: 'a.mp3', status: 'done', loaded: 4, location: 'music' });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it('runs two at a time and cancels queued ones without starting them', async () => {
    const started: string[] = [];
    const release: (() => void)[] = [];
    const target = fakeTarget((_ctx, f) => {
      started.push(f.name);
      return new Promise<void>((resolve) => release.push(resolve));
    });
    enqueueUploads(target, { location: '', currentPath: '' }, [file('1'), file('2'), file('3')]);
    expect(started).toEqual(['1', '2']);
    const third = useUploadStore.getState().items[2];
    cancelUpload(third.id);
    expect(useUploadStore.getState().items[2].status).toBe('canceled');
    release.forEach((r) => r());
    await flush();
    expect(started).toEqual(['1', '2']);
  });

  it('marks aborted uploads as canceled and failures as errors', async () => {
    const target = fakeTarget(async (_ctx, f, options) => {
      if (f.name === 'bad') throw new ApiError('conflict', 'Exists', 409);
      await new Promise((_resolve, reject) =>
        options.signal?.addEventListener('abort', () => reject(new ApiError('aborted', 'aborted', 0))));
    });
    enqueueUploads(target, { location: '', currentPath: '' }, [file('slow'), file('bad')]);
    cancelUpload(useUploadStore.getState().items[0].id);
    await flush();
    const [slow, bad] = useUploadStore.getState().items;
    expect(slow.status).toBe('canceled');
    expect(bad).toMatchObject({ status: 'error', error: 'Exists' });
    useUploadStore.getState().clearFinished();
    expect(useUploadStore.getState().items).toEqual([]);
  });
});
