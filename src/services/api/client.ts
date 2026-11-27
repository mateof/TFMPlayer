import axios, { type AxiosInstance, type AxiosError } from 'axios';
import { getServerConfig } from '@/db/database';
import { reportAuthorized, reportUnauthorized } from '@/stores/connectionStore';

class ApiClient {
  private client: AxiosInstance | null = null;
  private baseUrl: string = '';

  async getClient(): Promise<AxiosInstance> {
    if (this.client) return this.client;

    const config = await getServerConfig();
    if (!config) {
      throw new Error('Server not configured');
    }

    const { host, port, apiKey, useHttps } = config;
    this.baseUrl = `${useHttps ? 'https' : 'http'}://${host}:${port}`;

    this.client = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'X-API-Key': apiKey,
        'Content-Type': 'application/json'
      },
      // Short timeout so unreachable-server situations fail fast and screens
      // can fall back to their cached data instead of blocking for 30-60s
      timeout: 8000
    });

    // Fail immediately when the device has no network at all: waiting for a
    // timeout would freeze offline navigation for no reason
    this.client.interceptors.request.use((config) => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return Promise.reject(new Error('Device is offline'));
      }
      return config;
    });

    // A 401 never wipes the saved server: one endpoint asking for the key
    // (or a key changed on the server) would log the user out of everything.
    // The shell shows a banner leading to the server settings instead.
    this.client.interceptors.response.use(
      (response) => {
        reportAuthorized();
        return response;
      },
      (error: AxiosError) => {
        if (error.response?.status === 401) reportUnauthorized();
        return Promise.reject(error);
      }
    );

    return this.client;
  }

  getBaseUrl(): string {
    return this.baseUrl;
  }

  private apiKey: string = '';

  async getApiKey(): Promise<string> {
    if (this.apiKey) return this.apiKey;
    const config = await getServerConfig();
    if (config) {
      this.apiKey = config.apiKey;
    }
    return this.apiKey;
  }

  clearCache(): void {
    this.client = null;
    this.baseUrl = '';
    this.apiKey = '';
    reportAuthorized();
    this.resetListeners.forEach((listener) => listener());
  }

  // Things derived from the server (e.g. its capabilities) subscribe here to
  // be forgotten when the server configuration changes
  private resetListeners = new Set<() => void>();

  onReset(listener: () => void): void {
    this.resetListeners.add(listener);
  }

  async testConnection(host: string, port: number, apiKey: string, useHttps: boolean): Promise<boolean> {
    const testUrl = `${useHttps ? 'https' : 'http'}://${host}:${port}`;
    try {
      const response = await axios.get(`${testUrl}/api/mobile/channels`, {
        headers: {
          'X-API-Key': apiKey
        },
        timeout: 10000
      });
      return response.status === 200;
    } catch {
      return false;
    }
  }
}

export const apiClient = new ApiClient();

// Get base URL for API calls
export async function buildBaseUrl(): Promise<string> {
  await apiClient.getClient();
  return apiClient.getBaseUrl();
}

// Build stream URL for a track (Telegram File Manager files)
export async function buildStreamUrl(channelId: string, fileId: string, fileName?: string): Promise<string> {
  // Ensure client is initialized to get baseUrl
  await apiClient.getClient();
  const baseUrl = apiClient.getBaseUrl();
  let url = `${baseUrl}/api/mobile/stream/tfm/${channelId}/${fileId}`;
  if (fileName) {
    url += `?fileName=${encodeURIComponent(fileName)}`;
  }
  return url;
}

// Build stream URL with apiKey for direct audio element playback (enables native streaming)
export async function buildStreamUrlWithAuth(channelId: string, fileId: string, fileName?: string): Promise<string> {
  await apiClient.getClient();
  const baseUrl = apiClient.getBaseUrl();
  const apiKey = await apiClient.getApiKey();

  const params = new URLSearchParams();
  if (fileName) params.set('fileName', fileName);
  params.set('apiKey', apiKey);

  return `${baseUrl}/api/mobile/stream/tfm/${channelId}/${fileId}?${params.toString()}`;
}

// Build local stream URL with apiKey for direct audio element playback
export async function buildLocalStreamUrlWithAuth(filePath: string): Promise<string> {
  await apiClient.getClient();
  const baseUrl = apiClient.getBaseUrl();
  const apiKey = await apiClient.getApiKey();

  const params = new URLSearchParams();
  params.set('path', filePath);
  params.set('apiKey', apiKey);

  return `${baseUrl}/api/mobile/stream/local?${params.toString()}`;
}

// Transcoded download URL (offline downloads in MP3/AAC). Auth goes via the
// X-API-Key header, so no apiKey in the query string.
export function buildTranscodedUrlSync(
  channelId: string,
  fileId: string,
  format: string,
  bitrate: number,
  fileName?: string
): string {
  const baseUrl = apiClient.getBaseUrl();
  if (!baseUrl) {
    console.warn('buildTranscodedUrlSync called before API client initialized');
  }
  const params = new URLSearchParams();
  params.set('format', format);
  params.set('bitrate', String(bitrate));
  if (fileName) params.set('fileName', fileName);
  return `${baseUrl}/api/mobile/stream/tfm/${channelId}/${fileId}/transcoded?${params.toString()}`;
}

// Transcoded download URL for files in the server's local directory. Same
// contract as the channel one (auth via X-API-Key header).
export function buildLocalTranscodedUrlSync(
  filePath: string,
  format: string,
  bitrate: number
): string {
  const baseUrl = apiClient.getBaseUrl();
  if (!baseUrl) {
    console.warn('buildLocalTranscodedUrlSync called before API client initialized');
  }
  const params = new URLSearchParams();
  params.set('path', filePath);
  params.set('format', format);
  params.set('bitrate', String(bitrate));
  return `${baseUrl}/api/mobile/stream/local/transcoded?${params.toString()}`;
}

// v1 transcoded downloads (servers with `audio.transcode`). Same contract as
// the mobile ones (ranges, 501 without FFmpeg); auth via the X-API-Key header.
export function buildV1TranscodedUrlSync(channelId: string, fileId: string, format: string, bitrate: number): string {
  const params = new URLSearchParams({ format, bitrate: String(bitrate) });
  return `${apiClient.getBaseUrl()}/api/v1/channels/${encodeURIComponent(channelId)}/files/${encodeURIComponent(fileId)}/transcoded?${params.toString()}`;
}

export function buildV1LocalTranscodedUrlSync(filePath: string, format: string, bitrate: number): string {
  // v1 local paths are relative to the root, without a leading slash
  const path = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const params = new URLSearchParams({ path, format, bitrate: String(bitrate) });
  return `${apiClient.getBaseUrl()}/api/v1/local/transcoded?${params.toString()}`;
}
// Synchronous version that requires baseUrl to be pre-initialized
export function buildStreamUrlSync(channelId: string, fileId: string, fileName?: string): string {
  const baseUrl = apiClient.getBaseUrl();
  if (!baseUrl) {
    console.warn('buildStreamUrlSync called before API client initialized');
  }
  let url = `${baseUrl}/api/mobile/stream/tfm/${channelId}/${fileId}`;
  if (fileName) {
    url += `?fileName=${encodeURIComponent(fileName)}`;
  }
  return url;
}

// Synchronous version for local files that requires baseUrl to be pre-initialized
export function buildLocalStreamUrlSync(filePath: string): string {
  const baseUrl = apiClient.getBaseUrl();
  if (!baseUrl) {
    console.warn('buildLocalStreamUrlSync called before API client initialized');
  }
  return `${baseUrl}/api/mobile/stream/local?path=${encodeURIComponent(filePath)}`;
}
