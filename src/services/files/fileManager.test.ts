import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ApiFileDto } from '@/services/api/v1';
import type { ChannelFile } from '@/types/models';

const v1 = vi.hoisted(() => ({ client: null as unknown, fetch: null as unknown as ReturnType<typeof vi.fn> }));

vi.mock('@/services/api/v1', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/api/v1')>();
  return {
    ...actual,
    getV1Api: async () => v1.client,
    peekV1Api: () => v1.client
  };
});

import { createApiClient } from '@/services/api/v1';
import {
  apiFileToChannelFile, createChannelTarget, createLocalTarget, displayPath, entryNameProblem,
  listFolders, operationsFor, toLocalV1Path, viewerKind
} from './fileManager';
import { canPaste } from './clipboard';

const dto = (over: Partial<ApiFileDto> = {}): ApiFileDto => ({
  id: 'f1', name: 'pic.jpg', path: '/photos/', parentId: 'p1', isFile: true, hasChildren: false,
  size: 2048, sizeText: '2 KB', type: '.jpg', category: 'Photo', dateCreated: '2026-01-01T00:00:00Z',
  dateModified: '2026-01-02T00:00:00Z', messageId: 7, isSplit: false, md5Hash: 'abc', xxHash: null,
  streamUrl: null, downloadUrl: null,
  contentUrl: 'http://internal/api/v1/channels/1/files/f1/content',
  contentDownloadUrl: 'http://internal/api/v1/channels/1/files/f1/content?disposition=attachment',
  playbackUrl: null,
  thumbnailUrl: 'http://internal/api/v1/channels/1/messages/7/thumbnail',
  ...over
});

function respond(data: unknown, page = { page: 1, pageSize: 50, totalItems: 1, totalPages: 1, hasNext: false, hasPrevious: false }) {
  v1.fetch.mockResolvedValueOnce(new Response(JSON.stringify({ success: true, data, page })));
}

const ALL = new Set(['files.content', 'files.thumbnails', 'files.preload', 'local.copyMove', 'shares.browse', 'transfers.remove']);

beforeEach(() => {
  v1.fetch = vi.fn();
  v1.client = createApiClient({ baseUrl: 'http://pwa-host:8080', apiKey: 'k', fetch: v1.fetch as unknown as typeof fetch });
});

describe('conversion', () => {
  it('keeps hashes, media URLs and the folder path', () => {
    const file = apiFileToChannelFile(dto(), 'channel');
    expect(file).toMatchObject({ id: 'f1', category: 'Photo', path: '/photos/', folderPath: '/photos/', md5Hash: 'abc', messageId: 7, sizeText: '2 KB' });
    expect(displayPath(file, 'channel')).toBe('/photos/pic.jpg');
  });

  it('addresses local entries by their relative path', () => {
    const file = apiFileToChannelFile(dto({ id: 'music/a.mp3', path: '/music/', category: 'Audio', name: 'a.mp3' }), 'local');
    expect(file.path).toBe('/music/a.mp3');
    expect(file.id).toBe('/music/a.mp3');
    expect(displayPath(file, 'local')).toBe('/music/a.mp3');
  });

  it('maps unknown categories to Other (files) and Folder (folders)', () => {
    expect(apiFileToChannelFile(dto({ category: 'Weird' }), 'channel').category).toBe('Other');
    expect(apiFileToChannelFile(dto({ category: 'Weird', isFile: false }), 'channel').category).toBe('Folder');
  });

  it('normalizes local paths', () => {
    expect(toLocalV1Path('/music/rock/')).toBe('music/rock');
    expect(toLocalV1Path('a\\b')).toBe('a/b');
    expect(toLocalV1Path('')).toBe('');
  });
});

describe('viewerKind', () => {
  const f = (name: string, category: ChannelFile['category']) => apiFileToChannelFile(dto({ name, category }), 'channel');
  it('picks the viewer from category and extension', () => {
    expect(viewerKind(f('a.jpg', 'Photo'))).toBe('image');
    expect(viewerKind(f('a.mkv', 'Video'))).toBe('video');
    expect(viewerKind(f('a.mp3', 'Audio'))).toBe('audio');
    expect(viewerKind(f('a.pdf', 'Document'))).toBe('pdf');
    expect(viewerKind(f('notes.txt', 'Document'))).toBe('text');
    expect(viewerKind(f('a.zip', 'Archive'))).toBeNull();
    expect(viewerKind(f('x', 'Folder'))).toBeNull();
  });
});

describe('operationsFor', () => {
  it('offers nothing on servers without files.content', () => {
    expect(operationsFor('channel', new Set(['files.preload'])).size).toBe(0);
  });

  it('gates the optional operations by capability', () => {
    const basic = new Set(['files.content']);
    expect([...operationsFor('channel', basic)].sort()).toEqual(
      ['copy', 'createFolder', 'delete', 'downloadToDevice', 'downloadToServer', 'move', 'rename', 'shareLink', 'upload']
    );
    expect(operationsFor('channel', ALL).has('preload')).toBe(true);
    expect(operationsFor('channel', ALL).has('exportShare')).toBe(true);
    expect(operationsFor('local', basic).has('move')).toBe(false);
    expect(operationsFor('local', ALL).has('copy')).toBe(true);
    expect(operationsFor('local', ALL).has('downloadToServer')).toBe(false);
  });

  it('keeps shared collections read-only', () => {
    expect([...operationsFor('share', ALL)].sort()).toEqual(['downloadToDevice', 'downloadToServer', 'shareLink']);
  });
});

describe('channel target', () => {
  it('lists a folder through v1 and rebases media URLs onto the configured server', async () => {
    respond({ items: [dto()], currentPath: '/photos/' });
    const target = createChannelTarget('1', ALL);
    const page = await target.list('fid', 1, { pageSize: 50, filter: 'photo', sortBy: 'name', sortDesc: false });
    expect(String(v1.fetch.mock.calls[0][0])).toBe(
      'http://pwa-host:8080/api/v1/channels/1/files?page=1&pageSize=50&filter=photo&sortBy=name&sortDescending=false&folderId=fid'
    );
    expect(page).toMatchObject({ totalCount: 1, hasMore: false, currentPath: '/photos/' });
    const file = page.files[0];
    expect(target.contentUrl(file)).toBe('http://pwa-host:8080/api/v1/channels/1/files/f1/content?apiKey=k');
    expect(target.contentUrl(file, true)).toBe('http://pwa-host:8080/api/v1/channels/1/files/f1/content?disposition=attachment&apiKey=k');
    expect(target.thumbnailUrl(file)).toBe('http://pwa-host:8080/api/v1/channels/1/messages/7/thumbnail?apiKey=k');
  });

  it('hides thumbnails without files.thumbnails', () => {
    const target = createChannelTarget('1', new Set(['files.content']));
    expect(target.thumbnailUrl(apiFileToChannelFile(dto(), 'channel'))).toBeUndefined();
  });

  it('creates folders under the current path and moves by folder id', async () => {
    const target = createChannelTarget('1', ALL);
    respond(null);
    await target.createFolder({ location: 'fid', currentPath: '/music/' }, 'rock');
    respond({ accepted: 1, skipped: [] });
    await target.move([apiFileToChannelFile(dto(), 'channel')], { location: 'dest', path: '', name: 'Dest' });
    respond({ accepted: 1, skipped: [] });
    await target.copy([apiFileToChannelFile(dto(), 'channel')], { location: '', path: '/', name: '' });
    const body = (i: number) => JSON.parse(String(v1.fetch.mock.calls[i][1]?.body));
    expect(body(0)).toEqual({ path: '/music/', name: 'rock' });
    expect(body(1)).toEqual({ ids: ['f1'], targetFolderId: 'dest' });
    expect(body(2)).toEqual({ ids: ['f1'], targetPath: '/' });
  });

  it('downloads shared collection files to the server with their collection id', async () => {
    const target = createChannelTarget('1', ALL, 'col');
    expect(target.kind).toBe('share');
    respond({ accepted: 1, skipped: [], taskId: null });
    await target.downloadToServer([apiFileToChannelFile(dto(), 'share')]);
    expect(JSON.parse(String(v1.fetch.mock.calls[0][1]?.body))).toEqual({
      channelId: '1', fileIds: ['f1'], targetPath: null, sharedCollectionId: 'col'
    });
    await expect(target.rename(apiFileToChannelFile(dto(), 'share'), 'x')).rejects.toThrow();
  });
});

describe('local target', () => {
  it('lists, copies and builds download URLs with relative paths', async () => {
    const target = createLocalTarget(ALL);
    respond({ items: [dto({ id: 'music/a.mp3', name: 'a.mp3', category: 'Audio' })], currentPath: '/music/' });
    const page = await target.list('/music', 1, { pageSize: 50, filter: 'all', sortBy: 'name', sortDesc: true });
    expect(String(v1.fetch.mock.calls[0][0])).toContain('/api/v1/local?');
    expect(String(v1.fetch.mock.calls[0][0])).toContain('path=music');
    respond({ accepted: 1, skipped: [] });
    await target.copy(page.files, { location: 'backup', path: 'backup', name: 'backup' });
    expect(JSON.parse(String(v1.fetch.mock.calls[1][1]?.body))).toEqual({ paths: ['music/a.mp3'], targetPath: 'backup' });
    expect(target.contentUrl(page.files[0], true)).toBe('http://pwa-host:8080/api/v1/local/download?path=music%2Fa.mp3&apiKey=k');
  });

  it('refuses copy/move without local.copyMove', async () => {
    const target = createLocalTarget(new Set(['files.content']));
    await expect(target.copy([], { location: '', path: '', name: '' })).rejects.toThrow();
  });
});

describe('listFolders', () => {
  it('stops at the first page that has files', async () => {
    const target = createChannelTarget('1', ALL);
    const folder = dto({ id: 'd1', name: 'A', isFile: false, category: 'Folder' });
    respond({ items: [folder, dto()], currentPath: '/' }, { page: 1, pageSize: 200, totalItems: 400, totalPages: 2, hasNext: true, hasPrevious: false });
    const { folders, currentPath } = await listFolders(target, '');
    expect(folders.map((f) => f.id)).toEqual(['d1']);
    expect(currentPath).toBe('/');
    expect(v1.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('names and clipboard', () => {
  it('validates entry names', () => {
    expect(entryNameProblem('  ')).toBe('Enter a name');
    expect(entryNameProblem('a/b')).not.toBeNull();
    expect(entryNameProblem('a\\b')).not.toBeNull();
    expect(entryNameProblem('..')).not.toBeNull();
    expect(entryNameProblem('Rock 2026')).toBeNull();
  });

  it('pastes only into the same target and not into the source of a cut', () => {
    const folder = apiFileToChannelFile(dto({ id: 'd1', isFile: false, category: 'Folder' }), 'channel');
    const clip = { mode: 'cut' as const, targetKey: 'channel:1', fromLocation: 'src', files: [folder] };
    expect(canPaste(clip, 'channel:2', 'x')).toBe(false);
    expect(canPaste(clip, 'channel:1', 'src')).toBe(false);
    expect(canPaste(clip, 'channel:1', 'd1')).toBe(false);
    expect(canPaste(clip, 'channel:1', 'other')).toBe(true);
    expect(canPaste({ ...clip, mode: 'copy' }, 'channel:1', 'src')).toBe(true);
    expect(canPaste(null, 'channel:1', 'x')).toBe(false);
  });
});
