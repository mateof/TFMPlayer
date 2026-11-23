import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const search = vi.hoisted(() => vi.fn());

vi.mock('@/services/api/client', () => ({
  apiClient: { getClient: async () => ({}), onReset: () => {}, getBaseUrl: () => 'http://server' },
  buildBaseUrl: async () => 'http://server',
  buildStreamUrlSync: () => 'http://server/stream',
  buildLocalStreamUrlSync: () => 'http://server/local',
  buildTranscodedUrlSync: () => '',
  buildLocalTranscodedUrlSync: () => ''
}));
vi.mock('@/services/api/search.api', () => ({ searchApi: { search } }));

import { SearchPage } from './SearchPage';

function renderAt(url: string) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <SearchPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const audio = (name: string) => ({
  id: name, name, path: `/${name}`, parentId: '', size: 2048, type: '.mp3', category: 'Audio' as const,
  dateCreated: '', dateModified: '', isFile: true, hasChildren: false
});

describe('SearchPage', () => {
  it('asks for a longer query first', () => {
    renderAt('/search?q=a');
    expect(screen.getByText('Type at least 2 characters to search.')).toBeTruthy();
    expect(search).not.toHaveBeenCalled();
  });

  it('groups results by channel and local files', async () => {
    search.mockResolvedValue({
      channels: [{ channelId: '7', channelName: 'Jazz', files: [audio('so what.mp3')] }],
      local: [audio('blue.mp3')],
      truncated: false,
      mode: 'server'
    });
    renderAt('/search?q=blue&scope=all');

    await waitFor(() => expect(screen.getByText('Jazz')).toBeTruthy());
    expect(search).toHaveBeenCalledWith('blue', 'all', expect.anything());
    expect(screen.getByText('Local files', { selector: 'span' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play so what' })).toBeTruthy();
  });

  it('explains the favourites-only fallback of older servers', async () => {
    search.mockResolvedValue({ channels: [], local: [], truncated: false, mode: 'favorites' });
    renderAt('/search?q=blue');
    await waitFor(() =>
      expect(screen.getByText(/only your favourite channels were searched/)).toBeTruthy()
    );
  });
});
