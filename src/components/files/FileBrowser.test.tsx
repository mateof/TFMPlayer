import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChannelFile } from '@/types/models';
import type { FileManagerTarget, ManageOperation } from '@/services/files/fileManager';

vi.mock('@/services/api/client', () => ({
  apiClient: { getClient: async () => ({}), onReset: () => {}, getBaseUrl: () => 'http://server' },
  buildBaseUrl: async () => 'http://server',
  buildStreamUrlSync: () => 'http://server/stream',
  buildLocalStreamUrlSync: () => 'http://server/local',
  buildTranscodedUrlSync: () => '',
  buildLocalTranscodedUrlSync: () => ''
}));

// jsdom has no layout, so the real virtualizer renders nothing: render every row
vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (opts: { count: number; estimateSize: (i: number) => number }) => ({
    getVirtualItems: () => Array.from({ length: opts.count }, (_, index) => ({
      index, key: index, start: index * opts.estimateSize(index), size: opts.estimateSize(index), end: 0, lane: 0
    })),
    getTotalSize: () => opts.count * (opts.count ? opts.estimateSize(0) : 0),
    measureElement: () => {},
    measure: () => {},
    scrollToIndex: () => {}
  })
}));

import { FileBrowser, type FileSource } from './FileBrowser';

const file = (i: number, category: ChannelFile['category'] = 'Audio'): ChannelFile => ({
  id: `id${i}`,
  name: category === 'Folder' ? `Folder ${i}` : `song${i}.mp3`,
  path: '/',
  parentId: '',
  size: 1024,
  type: '.mp3',
  category,
  dateCreated: '2026-01-01',
  dateModified: '2026-01-01',
  isFile: category !== 'Folder',
  hasChildren: false
});

function renderBrowser(source: Partial<FileSource> = {}, extra: { manager?: FileManagerTarget; url?: string } = {}) {
  const fetchPage = vi.fn(async () => ({ files: [file(1, 'Folder'), file(2), file(3)], totalCount: 3, hasMore: false }));
  const fullSource: FileSource = {
    key: 'test',
    location: '',
    fetchPage,
    toTrack: (f) => ({
      fileId: f.id, channelId: '1', channelName: 'x', fileName: f.name, filePath: f.path,
      fileType: f.type, fileSize: f.size, order: 0, dateAdded: '', isLocalFile: false, streamUrl: ''
    }),
    collectFolder: async () => [],
    folderDragItem: (f) => ({ kind: 'local-folder', path: f.path, name: f.name }),
    ...source
  };
  const onOpenFolder = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[extra.url ?? '/x?filter=audio&sortBy=size']}>
        <FileBrowser
          source={fullSource}
          title="My channel"
          backPath="/channels"
          breadcrumbs={['Rock']}
          onNavigateBreadcrumb={() => {}}
          onOpenFolder={onOpenFolder}
          manager={extra.manager}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
  return { fetchPage, onOpenFolder };
}

describe('FileBrowser', () => {
  it('loads the first page with the filters from the URL', async () => {
    const { fetchPage } = renderBrowser();

    expect(screen.getByText('My channel')).toBeTruthy();
    await waitFor(() => expect(screen.getByText('3 files')).toBeTruthy());
    expect(fetchPage).toHaveBeenCalledWith(1, {
      pageSize: 50,
      filter: 'audio',
      search: undefined,
      sortBy: 'size',
      sortDesc: false
    });
    // Breadcrumb and toolbar
    expect(screen.getByRole('navigation', { name: 'Folder path' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play All' })).toBeTruthy();
  });

  it('opens the search bar', async () => {
    renderBrowser();
    fireEvent.click(screen.getByRole('button', { name: 'Search files' }));
    expect(screen.getByRole('searchbox', { name: 'Search files in this folder' })).toBeTruthy();
  });

  it('shows the empty state', async () => {
    renderBrowser({ fetchPage: async () => ({ files: [], totalCount: 0, hasMore: false }) });
    await waitFor(() => expect(screen.getByText('No files found')).toBeTruthy());
  });
});

function fakeManager(operations: ManageOperation[]): FileManagerTarget {
  const photo: ChannelFile = { ...file(5, 'Photo'), name: 'beach.jpg', type: '.jpg', md5Hash: 'cafe', folderPath: '/' };
  const pdf: ChannelFile = { ...file(6, 'Document'), name: 'manual.pdf', type: '.pdf' };
  return {
    kind: 'channel',
    key: 'channel:1',
    operations: new Set(operations),
    thumbnails: true,
    list: vi.fn(async () => ({ files: [file(1, 'Folder'), photo, pdf], totalCount: 3, hasMore: false, currentPath: '/' })),
    createFolder: vi.fn(),
    rename: vi.fn(),
    remove: vi.fn(),
    copy: vi.fn(),
    move: vi.fn(),
    upload: vi.fn(),
    downloadToServer: vi.fn(),
    preload: vi.fn(),
    exportShare: vi.fn(),
    contentUrl: () => 'http://server/content?apiKey=k',
    playbackUrl: () => 'http://server/content?apiKey=k',
    thumbnailUrl: () => undefined
  } as FileManagerTarget;
}

describe('FileBrowser Manage mode', () => {
  it('is not offered without a manager (old servers)', async () => {
    renderBrowser();
    await waitFor(() => expect(screen.getByText('3 files')).toBeTruthy());
    expect(screen.queryByRole('button', { name: /Manage/ })).toBeNull();
  });

  it('lists every file type through the manager and offers the gated actions', async () => {
    const manager = fakeManager(['createFolder', 'upload', 'rename', 'delete', 'downloadToDevice']);
    const { fetchPage } = renderBrowser({}, { manager });
    await waitFor(() => expect(fetchPage).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /Manage/ }));
    await waitFor(() => expect(screen.getByText('beach.jpg')).toBeTruthy());
    expect(manager.list).toHaveBeenCalledWith('', 1, { pageSize: 50, filter: 'all', search: undefined, sortBy: 'size', sortDesc: false }, expect.anything());
    expect(screen.getByText('manual.pdf')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New folder' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Upload files from this device' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Play All' })).toBeNull();

    // Details sheet with properties and only the supported actions
    fireEvent.click(screen.getByRole('button', { name: 'Details and actions for beach.jpg' }));
    const dialog = await screen.findByRole('dialog', { name: 'beach.jpg' });
    expect(dialog.textContent).toContain('cafe');
    expect(screen.getByRole('button', { name: 'Rename' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cut' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Preload on the server' })).toBeNull();
  });

  it('opens images in the viewer and switches to the grid', async () => {
    const manager = fakeManager([]);
    renderBrowser({}, { manager, url: '/x?manage=1' });
    fireEvent.click(await screen.findByRole('listitem', { name: 'File beach.jpg' }));
    const viewer = await screen.findByRole('dialog', { name: 'beach.jpg' });
    expect(viewer.querySelector('img')?.getAttribute('src')).toBe('http://server/content?apiKey=k');
    // The PDF is the next item of the gallery
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('dialog', { name: 'manual.pdf' });
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));

    fireEvent.click(screen.getByRole('button', { name: 'Show as grid' }));
    expect(screen.getByRole('button', { name: 'Show as list' })).toBeTruthy();
  });
});
