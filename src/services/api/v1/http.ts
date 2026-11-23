/**
 * Low level HTTP plumbing of the v1 API client.
 *
 * Mirrors `ClientApp/packages/api-client/src/http.ts` of TelegramFileManager
 * (same type and class names, same envelope handling) with the changes this
 * app needs as a cross-origin client:
 *
 * - Authentication is the mobile API key (`X-API-Key` header), not the web
 *   session cookie, so requests go with `credentials: 'omit'`.
 * - Media URLs for `<img>`, `<video>`, downloads... carry `?apiKey=` instead
 *   ({@link HttpClient.authUrl}), since those elements cannot send headers.
 * - Requests fail fast when the device is offline, like the axios client.
 * - {@link HttpClient.upload} sends multipart bodies with XMLHttpRequest to
 *   report upload progress (fetch cannot).
 *
 * Every v1 endpoint answers `{ success, data, error, message, page }`;
 * `request()` unwraps it and throws an {@link ApiError} on failure.
 */

/** Pagination block of list responses (mirrors `PageInfo`). */
export interface PageInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

/** Error detail of the envelope (mirrors `ApiError`). */
export interface ApiErrorBody {
  code: string;
  message: string;
  detail?: string | null;
}

/** The envelope every v1 endpoint returns (mirrors `ApiResult<T>`). */
export interface ApiEnvelope<T> {
  success: boolean;
  data: T | null;
  error?: ApiErrorBody | null;
  message?: string | null;
  page?: PageInfo | null;
}

/** A page of results: the unwrapped `data` plus the `page` block. */
export interface Paged<T> {
  items: T[];
  page: PageInfo;
}

/** Paging/sorting query shared by list endpoints (mirrors `PagedQuery`). */
export interface PagedQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDescending?: boolean;
}

/** Canonical error codes (mirrors `ApiErrorCodes`). */
export const ApiErrorCodes = {
  Unauthorized: 'unauthorized',
  InvalidRequest: 'invalid_request',
  NotFound: 'not_found',
  ChannelNotFound: 'channel_not_found',
  FileNotFound: 'file_not_found',
  TaskNotFound: 'task_not_found',
  Conflict: 'conflict',
  AlreadyRunning: 'already_running',
  Forbidden: 'forbidden',
  NotSupported: 'not_supported',
  ServiceUnavailable: 'service_unavailable',
  InternalError: 'internal_error',
  TooManyAttempts: 'too_many_attempts',
  /** Client side: the request never reached the server or the answer was not JSON. */
  NetworkError: 'network_error',
  /** Client side: the request was aborted through its AbortSignal. */
  Aborted: 'aborted'
} as const;

export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes] | (string & {});

/** Error thrown by every API call that does not succeed. */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  /** HTTP status (0 when the request failed before getting an answer). */
  readonly status: number;
  readonly detail?: string | null;

  constructor(code: ApiErrorCode, message: string, status: number, detail?: string | null) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.detail = detail;
  }

  get isUnauthorized(): boolean {
    return this.status === 401;
  }

  get isAborted(): boolean {
    return this.code === ApiErrorCodes.Aborted;
  }

  /** The server does not have the endpoint (older version). */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number | boolean)[];
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  query?: Query;
  /** JSON body (objects/arrays are serialised), or a FormData/Blob/string sent as-is. */
  body?: unknown;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

export interface UploadRequestOptions {
  query?: Query;
  signal?: AbortSignal;
  /** Bytes sent so far and the total, as reported by the browser. */
  onProgress?: (loaded: number, total: number) => void;
}

export interface HttpClientOptions {
  /** Server origin, e.g. `https://host:5000`. No trailing slash needed. */
  baseUrl?: string;
  /** Mobile API key; sent as `X-API-Key` and appended as `?apiKey=` to media URLs. */
  apiKey?: string;
  /** Custom fetch implementation (tests). */
  fetch?: typeof fetch;
  /** Custom XMLHttpRequest constructor (tests). */
  xhr?: () => XMLHttpRequest;
  /** Called on every 401 answer. */
  onUnauthorized?: (error: ApiError) => void;
}

const JSON_TYPE = 'application/json';

function isRawBody(body: unknown): body is BodyInit {
  return (
    typeof body === 'string' ||
    (typeof FormData !== 'undefined' && body instanceof FormData) ||
    (typeof Blob !== 'undefined' && body instanceof Blob) ||
    (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) ||
    body instanceof ArrayBuffer
  );
}

/** Builds `?query`, skipping null/undefined values and repeating arrays (`ids=1&ids=2`). */
export function buildQuery(query?: Query): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/** Adds `apiKey=` to an absolute URL (keeps the existing query and hash). */
export function appendApiKey(url: string, apiKey: string): string {
  if (!apiKey || !url) return url;
  const hashIndex = url.indexOf('#');
  const hash = hashIndex >= 0 ? url.slice(hashIndex) : '';
  const base = hashIndex >= 0 ? url.slice(0, hashIndex) : url;
  if (/[?&]apiKey=/.test(base)) return url;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}apiKey=${encodeURIComponent(apiKey)}${hash}`;
}

/**
 * Path + query of a URL. The server builds absolute media URLs from the host
 * it was reached at, which behind Docker or a proxy may not be the address
 * this device uses; the app always rebases them onto its own server URL.
 */
export function toPathAndQuery(pathOrUrl: string): string {
  if (!/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  try {
    const parsed = new URL(pathOrUrl);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return pathOrUrl;
  }
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export class HttpClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly xhrFactory: () => XMLHttpRequest;
  private readonly onUnauthorized?: (error: ApiError) => void;

  constructor(options: HttpClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? '').replace(/\/+$/, '');
    this.apiKey = options.apiKey ?? '';
    // Bind lazily so tests can replace globalThis.fetch after the client exists
    this.fetchImpl = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.xhrFactory = options.xhr ?? (() => new XMLHttpRequest());
    this.onUnauthorized = options.onUnauthorized;
  }

  /** Absolute URL for a path. */
  url(path: string, query?: Query): string {
    return `${this.baseUrl}${path}${buildQuery(query)}`;
  }

  /**
   * URL usable without headers (`<img src>`, `<video src>`, downloads, new
   * tabs). Accepts a path or an absolute URL the server handed out.
   */
  authUrl(pathOrUrl: string, query?: Query): string {
    let url = this.url(toPathAndQuery(pathOrUrl));
    const extra = buildQuery(query);
    if (extra) url += (url.includes('?') ? '&' : '?') + extra.slice(1);
    return appendApiKey(url, this.apiKey);
  }

  private headersFor(method: string, extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = { Accept: JSON_TYPE, ...extra };
    if (this.apiKey) headers['X-API-Key'] = this.apiKey;
    if (method.toUpperCase() !== 'GET' && method.toUpperCase() !== 'HEAD') {
      // The server's CSRF guard; harmless with the API key, required on LAN bypass
      headers['X-Requested-With'] = 'tfm';
    }
    return headers;
  }

  /** Sends a request and returns the raw Response (throws ApiError on network/abort/HTTP error). */
  async raw(method: string, path: string, options: RequestOptions = {}): Promise<Response> {
    if (isOffline()) throw new ApiError(ApiErrorCodes.NetworkError, 'Device is offline', 0);
    const headers = this.headersFor(method, options.headers);
    let body: BodyInit | undefined;
    if (options.body !== undefined) {
      if (isRawBody(options.body)) {
        body = options.body;
      } else {
        body = JSON.stringify(options.body);
        headers['Content-Type'] = JSON_TYPE;
      }
    }

    let response: Response;
    try {
      response = await this.fetchImpl(this.url(path, options.query), {
        method,
        headers,
        body,
        credentials: 'omit',
        signal: options.signal
      });
    } catch (err) {
      if (options.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw new ApiError(ApiErrorCodes.Aborted, 'The request was aborted', 0);
      }
      throw new ApiError(ApiErrorCodes.NetworkError, err instanceof Error ? err.message : 'Network error', 0);
    }

    if (!response.ok) {
      throw this.errorFrom(response.status, response.statusText, await response.text().catch(() => ''));
    }
    return response;
  }

  /** Sends a request and returns the whole (successful) envelope. */
  async envelope<T>(method: string, path: string, options: RequestOptions = {}): Promise<ApiEnvelope<T>> {
    const response = await this.raw(method, path, options);
    const envelope = this.parseEnvelope<T>(response.status, await response.text());
    if (!envelope.success) {
      const e = envelope.error;
      throw new ApiError(e?.code ?? ApiErrorCodes.InternalError, e?.message || envelope.message || 'Request failed', response.status, e?.detail);
    }
    return envelope;
  }

  /** Sends a request and returns `data` (typed). */
  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const envelope = await this.envelope<T>(method, path, options);
    return envelope.data as T;
  }

  /** Sends a request to a paged endpoint and returns `{ items, page }`. */
  async requestPaged<T>(method: string, path: string, options: RequestOptions = {}): Promise<Paged<T>> {
    const envelope = await this.envelope<T[]>(method, path, options);
    const items = envelope.data ?? [];
    const page = envelope.page ?? {
      page: 1,
      pageSize: items.length,
      totalItems: items.length,
      totalPages: items.length ? 1 : 0,
      hasNext: false,
      hasPrevious: false
    };
    return { items, page };
  }

  get<T>(path: string, options?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  put<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  delete<T = void>(path: string, body?: unknown, options?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, { ...options, body });
  }

  getPaged<T>(path: string, options?: RequestOptions): Promise<Paged<T>> {
    return this.requestPaged<T>('GET', path, options);
  }

  /** POSTs a multipart body reporting upload progress; resolves to `data`. */
  upload<T = void>(path: string, form: FormData, options: UploadRequestOptions = {}): Promise<T> {
    if (isOffline()) return Promise.reject(new ApiError(ApiErrorCodes.NetworkError, 'Device is offline', 0));
    return new Promise<T>((resolve, reject) => {
      const xhr = this.xhrFactory();
      const { signal } = options;
      const onAbort = () => xhr.abort();
      if (signal?.aborted) {
        reject(new ApiError(ApiErrorCodes.Aborted, 'The request was aborted', 0));
        return;
      }
      signal?.addEventListener('abort', onAbort);
      const cleanup = () => signal?.removeEventListener('abort', onAbort);

      xhr.open('POST', this.url(path, options.query));
      for (const [key, value] of Object.entries(this.headersFor('POST'))) xhr.setRequestHeader(key, value);
      xhr.upload.onprogress = (e) => options.onProgress?.(e.loaded, e.lengthComputable ? e.total : 0);
      xhr.onload = () => {
        cleanup();
        const text = typeof xhr.responseText === 'string' ? xhr.responseText : '';
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(this.errorFrom(xhr.status, xhr.statusText, text));
          return;
        }
        try {
          const envelope = this.parseEnvelope<T>(xhr.status, text);
          if (!envelope.success) {
            reject(new ApiError(envelope.error?.code ?? ApiErrorCodes.InternalError, envelope.error?.message || envelope.message || 'Request failed', xhr.status));
            return;
          }
          resolve(envelope.data as T);
        } catch (err) {
          reject(err);
        }
      };
      xhr.onerror = () => {
        cleanup();
        reject(new ApiError(ApiErrorCodes.NetworkError, 'Network error', 0));
      };
      xhr.onabort = () => {
        cleanup();
        reject(new ApiError(ApiErrorCodes.Aborted, 'The request was aborted', 0));
      };
      xhr.send(form);
    });
  }

  private parseEnvelope<T>(status: number, text: string): ApiEnvelope<T> {
    if (status === 204 || !text) return { success: true, data: null };
    try {
      return JSON.parse(text) as ApiEnvelope<T>;
    } catch {
      throw new ApiError(ApiErrorCodes.NetworkError, 'The server answer is not valid JSON', status, text.slice(0, 200));
    }
  }

  private errorFrom(status: number, statusText: string, text: string): ApiError {
    let code: string = defaultCodeFor(status);
    let message = statusText || `HTTP ${status}`;
    let detail: string | null | undefined;
    try {
      if (text) {
        const parsed = JSON.parse(text) as Partial<ApiEnvelope<unknown>> & { title?: string };
        if (parsed.error) {
          code = parsed.error.code || code;
          message = parsed.error.message || message;
          detail = parsed.error.detail;
        } else if (parsed.message) {
          message = parsed.message;
        } else if (parsed.title) {
          // ASP.NET ProblemDetails (model validation)
          message = parsed.title;
        }
      }
    } catch {
      // not JSON: keep the HTTP status text
    }
    const error = new ApiError(code, message, status, detail);
    if (status === 401) this.onUnauthorized?.(error);
    return error;
  }
}

function defaultCodeFor(status: number): string {
  switch (status) {
    case 400:
      return ApiErrorCodes.InvalidRequest;
    case 401:
      return ApiErrorCodes.Unauthorized;
    case 403:
      return ApiErrorCodes.Forbidden;
    case 404:
      return ApiErrorCodes.NotFound;
    case 409:
      return ApiErrorCodes.Conflict;
    case 429:
      return ApiErrorCodes.TooManyAttempts;
    case 503:
      return ApiErrorCodes.ServiceUnavailable;
    default:
      return ApiErrorCodes.InternalError;
  }
}
