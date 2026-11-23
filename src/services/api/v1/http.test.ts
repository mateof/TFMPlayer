import { describe, expect, it, vi } from 'vitest';
import { ApiError, appendApiKey, buildQuery, HttpClient, toPathAndQuery } from './http';

// Same cases as ClientApp/packages/api-client/src/http.test.ts, adapted to the
// API key authentication of this app, plus the app-only helpers.

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function clientWith(response: Response | (() => Promise<Response>), apiKey = 'k3y') {
  const fetchMock = vi.fn<typeof fetch>(async () => (typeof response === 'function' ? response() : response));
  return { http: new HttpClient({ baseUrl: 'http://host:5000', apiKey, fetch: fetchMock }), fetchMock };
}

describe('HttpClient (v1 port)', () => {
  it('unwraps the envelope data', async () => {
    const { http } = clientWith(jsonResponse({ success: true, data: { id: 1 }, error: null }));
    await expect(http.get<{ id: number }>('/api/v1/x')).resolves.toEqual({ id: 1 });
  });

  it('returns items and page for paged endpoints', async () => {
    const page = { page: 2, pageSize: 10, totalItems: 25, totalPages: 3, hasNext: true, hasPrevious: true };
    const { http } = clientWith(jsonResponse({ success: true, data: [1, 2], page }));
    await expect(http.getPaged<number>('/api/v1/x')).resolves.toEqual({ items: [1, 2], page });
  });

  it('throws ApiError with code and status from an error envelope', async () => {
    const { http } = clientWith(
      jsonResponse({ success: false, data: null, error: { code: 'channel_not_found', message: 'No such channel', detail: 'id=5' } }, 404)
    );
    const err = await http.get('/api/v1/channels/5').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: 'channel_not_found', status: 404, message: 'No such channel', detail: 'id=5', isNotFound: true });
  });

  it('throws when a 200 answer says success: false', async () => {
    const { http } = clientWith(jsonResponse({ success: false, data: null, error: { code: 'conflict', message: 'Busy' } }));
    await expect(http.post('/api/v1/x')).rejects.toMatchObject({ code: 'conflict', status: 200 });
  });

  it('maps a non-JSON error to a code derived from the status', async () => {
    const { http } = clientWith(new Response('boom', { status: 503, statusText: 'Service Unavailable' }));
    await expect(http.get('/x')).rejects.toMatchObject({ code: 'service_unavailable', status: 503 });
  });

  it('reports network failures as network_error', async () => {
    const { http } = clientWith(() => Promise.reject(new TypeError('Failed to fetch')));
    await expect(http.get('/x')).rejects.toMatchObject({ code: 'network_error', status: 0 });
  });

  it('reports aborted requests as aborted', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    const http = new HttpClient({ fetch: fetchMock });
    const pending = http.get('/x', { signal: controller.signal });
    controller.abort();
    const err = await pending.catch((e: unknown) => e);
    expect((err as ApiError).isAborted).toBe(true);
  });

  it('sends the API key, the CSRF header and a JSON body, without cookies', async () => {
    const { http, fetchMock } = clientWith(jsonResponse({ success: true, data: null }));
    await http.post('/api/v1/x', { a: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://host:5000/api/v1/x');
    const headers = init?.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('k3y');
    expect(headers['X-Requested-With']).toBe('tfm');
    expect(headers['Content-Type']).toBe('application/json');
    expect(init?.body).toBe('{"a":1}');
    expect(init?.credentials).toBe('omit');
  });

  it('does not send the CSRF header on GET', async () => {
    const { http, fetchMock } = clientWith(jsonResponse({ success: true, data: null }));
    await http.get('/api/v1/x');
    const headers = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['X-Requested-With']).toBeUndefined();
    expect(headers['X-API-Key']).toBe('k3y');
  });

  it('calls onUnauthorized on 401', async () => {
    const onUnauthorized = vi.fn();
    const http = new HttpClient({
      fetch: async () => jsonResponse({ success: false, error: { code: 'unauthorized', message: 'Bad key' } }, 401),
      onUnauthorized
    });
    await expect(http.get('/api/v1/x')).rejects.toMatchObject({ status: 401, isUnauthorized: true });
    expect(onUnauthorized).toHaveBeenCalledOnce();
  });

  it('treats empty bodies as success with null data', async () => {
    const { http } = clientWith(new Response(null, { status: 204 }));
    await expect(http.delete('/x')).resolves.toBeNull();
  });

  it('builds query strings on the base URL', async () => {
    const { http, fetchMock } = clientWith(jsonResponse({ success: true, data: 1 }));
    await http.get('/api/v1/x', { query: { q: 'a b', skip: undefined } });
    expect(fetchMock.mock.calls[0][0]).toBe('http://host:5000/api/v1/x?q=a+b');
  });

  it('fails fast when the device is offline', async () => {
    const { http, fetchMock } = clientWith(jsonResponse({ success: true, data: 1 }));
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    await expect(http.get('/api/v1/x')).rejects.toMatchObject({ code: 'network_error' });
    expect(fetchMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('media URLs', () => {
  it('rebases server URLs onto the configured server and adds the API key', () => {
    const { http } = clientWith(jsonResponse({}), 'a/b');
    expect(http.authUrl('http://172.17.0.2:80/api/v1/channels/1/files/abc/content?disposition=attachment'))
      .toBe('http://host:5000/api/v1/channels/1/files/abc/content?disposition=attachment&apiKey=a%2Fb');
    expect(http.authUrl('/api/v1/local/download', { path: 'music/a b.mp3', disposition: undefined }))
      .toBe('http://host:5000/api/v1/local/download?path=music%2Fa+b.mp3&apiKey=a%2Fb');
  });

  it('does not add the key twice or without a key', () => {
    expect(appendApiKey('http://h/x?apiKey=1', 'k')).toBe('http://h/x?apiKey=1');
    expect(appendApiKey('http://h/x', '')).toBe('http://h/x');
    expect(appendApiKey('http://h/x#frag', 'k')).toBe('http://h/x?apiKey=k#frag');
  });

  it('keeps relative paths as they are', () => {
    expect(toPathAndQuery('/api/v1/x?y=1')).toBe('/api/v1/x?y=1');
    expect(toPathAndQuery('https://a.b/c?d=1')).toBe('/c?d=1');
  });
});

describe('multipart upload', () => {
  class FakeXhr {
    static last: FakeXhr;
    method = '';
    url = '';
    headers: Record<string, string> = {};
    status = 0;
    statusText = '';
    responseText = '';
    upload: { onprogress: ((e: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onprogress: null };
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    body: unknown;
    constructor() {
      FakeXhr.last = this;
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(k: string, v: string) {
      this.headers[k] = v;
    }
    send(body: unknown) {
      this.body = body;
    }
    abort() {
      this.onabort?.();
    }
  }

  const make = () => new HttpClient({
    baseUrl: 'http://host:5000',
    apiKey: 'k',
    xhr: () => new FakeXhr() as unknown as XMLHttpRequest
  });

  it('reports progress and resolves with the data', async () => {
    const onProgress = vi.fn();
    const form = new FormData();
    const pending = make().upload<{ id: string }>('/api/v1/local/upload', form, { onProgress });
    const xhr = FakeXhr.last;
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe('http://host:5000/api/v1/local/upload');
    expect(xhr.headers['X-API-Key']).toBe('k');
    expect(xhr.body).toBe(form);
    xhr.upload.onprogress?.({ loaded: 5, total: 10, lengthComputable: true });
    expect(onProgress).toHaveBeenCalledWith(5, 10);
    xhr.status = 201;
    xhr.responseText = JSON.stringify({ success: true, data: { id: 'a.mp3' } });
    xhr.onload?.();
    await expect(pending).resolves.toEqual({ id: 'a.mp3' });
  });

  it('maps HTTP errors and cancellation', async () => {
    const failing = make().upload('/x', new FormData());
    FakeXhr.last.status = 409;
    FakeXhr.last.responseText = JSON.stringify({ success: false, error: { code: 'conflict', message: 'Exists' } });
    FakeXhr.last.onload?.();
    await expect(failing).rejects.toMatchObject({ code: 'conflict', status: 409 });

    const controller = new AbortController();
    const canceled = make().upload('/x', new FormData(), { signal: controller.signal });
    controller.abort();
    await expect(canceled).rejects.toMatchObject({ isAborted: true });
  });
});

describe('buildQuery', () => {
  it('skips empty values and repeats arrays', () => {
    expect(buildQuery({ a: 1, b: undefined, c: null, d: ['x', 'y'], e: false })).toBe('?a=1&d=x&d=y&e=false');
    expect(buildQuery({})).toBe('');
    expect(buildQuery()).toBe('');
  });
});
