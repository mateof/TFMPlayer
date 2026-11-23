import { describe, expect, it, vi } from 'vitest';
import { HttpClient } from './http';
import { createFilesApi } from './modules/files';
import { createLocalApi } from './modules/local';
import { createTransfersApi } from './modules/transfers';
import { createSharesApi } from './modules/shares';

function setup(data: unknown = null, page?: unknown) {
  const fetchMock = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ success: true, data, page })));
  const http = new HttpClient({ baseUrl: 'http://h', apiKey: 'k', fetch: fetchMock });
  const call = (i = 0) => {
    const [url, init] = fetchMock.mock.calls[i];
    return { url: String(url), method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined };
  };
  return { http, fetchMock, call };
}

describe('files module', () => {
  it('browses a folder by id with the shared collection', async () => {
    const contents = { items: [{ id: 'a' }], currentPath: '/x/' };
    const page = { page: 1, pageSize: 50, totalItems: 1, totalPages: 1, hasNext: false, hasPrevious: false };
    const { http, call } = setup(contents, page);
    const result = await createFilesApi(http).list(123, { folderId: 'f1', filter: 'all', collectionId: 'col', page: 1 });
    expect(call().url).toBe('http://h/api/v1/channels/123/files?folderId=f1&filter=all&collectionId=col&page=1');
    expect(result).toEqual({ contents, page });
  });

  it('sends the mutation bodies the server expects', async () => {
    const { http, call } = setup({ accepted: 1, skipped: [], taskId: null });
    const files = createFilesApi(http);
    await files.createFolder('1', { path: '/music/', name: 'rock' });
    await files.rename('1', 'id/x', { newName: 'b.mp3' });
    await files.delete('1', { ids: ['a', 'b'] });
    await files.copy('1', { ids: ['a'], targetFolderId: 'f2' });
    await files.move('1', { ids: ['a'], targetPath: '/' });
    await files.preload('1', { fileIds: ['a'] });
    expect(call(0)).toEqual({ url: 'http://h/api/v1/channels/1/files/folders', method: 'POST', body: { path: '/music/', name: 'rock' } });
    expect(call(1)).toEqual({ url: 'http://h/api/v1/channels/1/files/id%2Fx/name', method: 'PUT', body: { newName: 'b.mp3' } });
    expect(call(2)).toMatchObject({ url: 'http://h/api/v1/channels/1/files/delete', body: { ids: ['a', 'b'] } });
    expect(call(3)).toMatchObject({ url: 'http://h/api/v1/channels/1/files/copy', body: { ids: ['a'], targetFolderId: 'f2' } });
    expect(call(4)).toMatchObject({ url: 'http://h/api/v1/channels/1/files/move', body: { ids: ['a'], targetPath: '/' } });
    expect(call(5)).toMatchObject({ url: 'http://h/api/v1/channels/1/files/preload', body: { fileIds: ['a'] } });
  });

  it('builds content URLs with the API key', () => {
    const { http } = setup();
    const files = createFilesApi(http);
    expect(files.contentUrl(1, 'abc')).toBe('http://h/api/v1/channels/1/files/abc/content?apiKey=k');
    expect(files.contentUrl(1, 'abc', { attachment: true, collectionId: 'c' }))
      .toBe('http://h/api/v1/channels/1/files/abc/content?disposition=attachment&collectionId=c&apiKey=k');
  });
});

describe('local module', () => {
  it('uses relative paths for every call', async () => {
    const { http, call } = setup({ accepted: 1, skipped: [] });
    const local = createLocalApi(http);
    await local.createFolder({ path: 'music', name: 'rock' });
    await local.rename({ path: 'music/a.mp3', newName: 'b.mp3' });
    await local.delete({ paths: ['music/b.mp3'] });
    await local.copy({ paths: ['a'], targetPath: 'backup' });
    await local.move({ paths: ['a'], targetPath: 'backup', overwrite: true });
    expect(call(0)).toMatchObject({ url: 'http://h/api/v1/local/folders', body: { path: 'music', name: 'rock' } });
    expect(call(1)).toMatchObject({ url: 'http://h/api/v1/local/rename', body: { path: 'music/a.mp3', newName: 'b.mp3' } });
    expect(call(2)).toMatchObject({ url: 'http://h/api/v1/local/delete', body: { paths: ['music/b.mp3'] } });
    expect(call(3)).toMatchObject({ url: 'http://h/api/v1/local/copy', body: { paths: ['a'], targetPath: 'backup' } });
    expect(call(4)).toMatchObject({ url: 'http://h/api/v1/local/move', body: { paths: ['a'], targetPath: 'backup', overwrite: true } });
    expect(local.downloadUrl('music/a.mp3', true)).toBe('http://h/api/v1/local/download?path=music%2Fa.mp3&disposition=inline&apiKey=k');
    expect(local.downloadUrl('music/a.mp3')).toBe('http://h/api/v1/local/download?path=music%2Fa.mp3&apiKey=k');
  });
});

describe('transfers module', () => {
  it('maps the queue controls to their endpoints', async () => {
    const { http, call } = setup();
    const transfers = createTransfersApi(http);
    await transfers.snapshot();
    await transfers.startDownload({ channelId: '1', fileIds: ['a'], targetPath: null, sharedCollectionId: 'c' });
    await transfers.pause('t 1');
    await transfers.retry('t1');
    await transfers.cancel('t1');
    await transfers.remove('t1');
    await transfers.clear({ scope: 'all', states: ['completed', 'failed'] });
    expect(call(0)).toMatchObject({ url: 'http://h/api/v1/transfers', method: 'GET' });
    expect(call(1)).toMatchObject({ url: 'http://h/api/v1/transfers/downloads', body: { channelId: '1', fileIds: ['a'], targetPath: null, sharedCollectionId: 'c' } });
    expect(call(2)).toMatchObject({ url: 'http://h/api/v1/transfers/t%201/pause', method: 'POST' });
    expect(call(3)).toMatchObject({ url: 'http://h/api/v1/transfers/t1/retry', method: 'POST' });
    expect(call(4)).toMatchObject({ url: 'http://h/api/v1/transfers/t1/cancel', method: 'POST' });
    expect(call(5)).toMatchObject({ url: 'http://h/api/v1/transfers/t1', method: 'DELETE' });
    expect(call(6)).toMatchObject({ url: 'http://h/api/v1/transfers/clear?scope=all&states=completed%2Cfailed', method: 'POST' });
  });
});

describe('shares module', () => {
  it('lists and exports', async () => {
    const { http, call } = setup([]);
    const shares = createSharesApi(http);
    await shares.list({ page: 2, filter: 'rock' });
    await shares.export({ channelId: '1', folderId: 'f', name: 'My music' });
    expect(call(0).url).toBe('http://h/api/v1/shares?page=2&filter=rock');
    expect(call(1).url).toBe('http://h/api/v1/shares/export?channelId=1&folderId=f&name=My+music');
  });
});
