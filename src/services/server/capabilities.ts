import { isAxiosError } from 'axios';
import { apiClient } from '@/services/api/client';

/**
 * Optional server features, advertised by TelegramFileManager in
 * GET /api/mobile/capabilities. Older servers do not have the endpoint (404):
 * they get an empty set and every caller falls back to the old behaviour.
 */
export type ServerFeature =
  | 'playlist.bulkAdd'
  | 'search.global'
  | 'channels.refresh'
  | 'channels.refreshProgress'
  | 'stream.localTranscode';

export interface ServerCapabilities {
  apiVersion: number;
  serverVersion: string | null;
  features: Set<string>;
}

const EMPTY: ServerCapabilities = { apiVersion: 0, serverVersion: null, features: new Set() };

let cached: ServerCapabilities | null = null;
let inflight: Promise<ServerCapabilities> | null = null;

async function fetchCapabilities(): Promise<ServerCapabilities> {
  try {
    const client = await apiClient.getClient();
    const { data } = await client.get<{
      data?: { apiVersion?: number; serverVersion?: string; features?: string[] };
    }>('/api/mobile/capabilities');
    const payload = data?.data ?? {};
    return {
      apiVersion: payload.apiVersion ?? 0,
      serverVersion: payload.serverVersion ?? null,
      features: new Set(payload.features ?? [])
    };
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 404) {
      // Server predates the endpoint: remember it, no features
      return EMPTY;
    }
    // Network trouble: don't remember, ask again next time
    throw error;
  }
}

export const serverCapabilities = {
  /** Capabilities of the configured server (asked once per session). */
  async get(): Promise<ServerCapabilities> {
    if (cached) return cached;
    if (!inflight) {
      inflight = fetchCapabilities()
        .then((caps) => {
          cached = caps;
          return caps;
        })
        .finally(() => {
          inflight = null;
        });
    }
    try {
      return await inflight;
    } catch {
      return EMPTY;
    }
  },

  async has(feature: ServerFeature): Promise<boolean> {
    return (await this.get()).features.has(feature);
  },

  /**
   * The server answered as if a feature advertised as available was not
   * there (e.g. proxied to an older instance): stop using it this session.
   */
  markUnavailable(feature: ServerFeature) {
    if (cached) {
      const features = new Set(cached.features);
      features.delete(feature);
      cached = { ...cached, features };
    }
  },

  /** Forget what we know (server settings changed). */
  reset() {
    cached = null;
    inflight = null;
  }
};

apiClient.onReset(() => serverCapabilities.reset());
