import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

const http = vi.hoisted(() => ({ get: vi.fn() }));

vi.mock('@/services/api/client', () => ({
  apiClient: { getClient: async () => http, onReset: () => {} }
}));

import { serverCapabilities } from './capabilities';

const notFound = () =>
  new AxiosError('nf', '404', undefined, undefined, {
    status: 404,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {}
  });

describe('serverCapabilities', () => {
  beforeEach(() => {
    serverCapabilities.reset();
    http.get.mockReset();
  });

  it('reads the advertised features once and caches them', async () => {
    http.get.mockResolvedValue({
      data: { data: { apiVersion: 1, serverVersion: '3.8.0', features: ['playlist.bulkAdd', 'search.global'] } }
    });

    expect(await serverCapabilities.has('playlist.bulkAdd')).toBe(true);
    expect(await serverCapabilities.has('channels.refresh')).toBe(false);
    expect((await serverCapabilities.get()).serverVersion).toBe('3.8.0');
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('treats a 404 as an old server without features (and remembers it)', async () => {
    http.get.mockRejectedValue(notFound());

    expect(await serverCapabilities.has('playlist.bulkAdd')).toBe(false);
    await serverCapabilities.get();
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('asks again after a network error instead of caching it', async () => {
    http.get.mockRejectedValueOnce(new Error('offline')).mockResolvedValue({
      data: { data: { features: ['search.global'] } }
    });

    expect(await serverCapabilities.has('search.global')).toBe(false);
    expect(await serverCapabilities.has('search.global')).toBe(true);
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('shares one request between concurrent callers', async () => {
    http.get.mockResolvedValue({ data: { data: { features: [] } } });
    await Promise.all([serverCapabilities.get(), serverCapabilities.get(), serverCapabilities.get()]);
    expect(http.get).toHaveBeenCalledTimes(1);
  });

  it('can drop a feature that turned out not to work', async () => {
    http.get.mockResolvedValue({ data: { data: { features: ['playlist.bulkAdd'] } } });
    await serverCapabilities.get();
    serverCapabilities.markUnavailable('playlist.bulkAdd');
    expect(await serverCapabilities.has('playlist.bulkAdd')).toBe(false);
  });
});
