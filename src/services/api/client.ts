import axios, { type AxiosInstance, type AxiosError } from 'axios';
import { db, getServerConfig } from '@/db/database';

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

    // Response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error: AxiosError) => {
        if (error.response?.status === 401) {
          // Clear config on unauthorized
          db.serverConfig.clear();
          this.clearCache();
        }
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
