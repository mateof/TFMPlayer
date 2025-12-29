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
      timeout: 30000
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
