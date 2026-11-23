import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ChannelFile } from '@/types/models';

vi.mock('@/services/api/client', () => ({
  apiClient: { getClient: async () => ({}), onReset: () => {}, getBaseUrl: () => 'http://server' },
  buildBaseUrl: async () => 'http://server',
  buildStreamUrlSync: () => 'http://server/stream',
  buildLocalStreamUrlSync: () => 'http://server/local',
  buildTranscodedUrlSync: () => '',
  buildLocalTranscodedUrlSync: () => ''
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

function renderBrowser(source: Partial<FileSource> = {}) {
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
      <MemoryRouter initialEntries={['/x?filter=audio&sortBy=size']}>
        <FileBrowser
          source={fullSource}
          title="My channel"
          backPath="/channels"
          breadcrumbs={['Rock']}
          onNavigateBreadcrumb={() => {}}
          onOpenFolder={onOpenFolder}
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
