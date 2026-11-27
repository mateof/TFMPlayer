/**
 * Typed client of the TelegramFileManager v1 API (`/api/v1/*`).
 *
 * The modules mirror `ClientApp/packages/api-client` of the server repo (same
 * type and function names) so both clients stay easy to compare; this app
 * keeps its own copy instead of depending on the package across repos, and
 * authenticates with the mobile API key like the rest of the app.
 */
import { apiClient } from '@/services/api/client';
import { getServerConfig } from '@/db/database';
import { reportUnauthorized } from '@/stores/connectionStore';
import { HttpClient, type HttpClientOptions } from './http';
import { createFilesApi } from './modules/files';
import { createLocalApi } from './modules/local';
import { createSharesApi } from './modules/shares';
import { createTransfersApi } from './modules/transfers';
import { createSearchApi } from './modules/search';
import { createPlayerApi } from './modules/player';
import { createMessagesApi } from './modules/messages';

export * from './http';
export type * from './types/files';
export type * from './types/local';
export type * from './types/shares';
export type * from './types/transfers';
export type * from './types/channels';
export type * from './modules/search';
export type * from './modules/player';
export type * from './modules/messages';

/** The v1 modules this app uses, on one HTTP client. */
export function createApiClient(options: HttpClientOptions = {}) {
  const http = new HttpClient(options);
  return {
    http,
    files: createFilesApi(http),
    local: createLocalApi(http),
    transfers: createTransfersApi(http),
    shares: createSharesApi(http),
    search: createSearchApi(http),
    player: createPlayerApi(http),
    messages: createMessagesApi(http)
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;

let current: ApiClient | null = null;

/** Client for the configured server (built once, rebuilt when the settings change). */
export async function getV1Api(): Promise<ApiClient> {
  if (current) return current;
  const config = await getServerConfig();
  if (!config) throw new Error('Server not configured');
  current = createApiClient({
    baseUrl: `${config.useHttps ? 'https' : 'http'}://${config.host}:${config.port}`,
    apiKey: config.apiKey,
    onUnauthorized: reportUnauthorized
  });
  return current;
}

/** Already-built client, for synchronous URL building once a screen has loaded. */
export function peekV1Api(): ApiClient | null {
  return current;
}

apiClient.onReset(() => {
  current = null;
});
