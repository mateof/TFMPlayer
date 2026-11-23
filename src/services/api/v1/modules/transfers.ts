// Mirrors ClientApp/packages/api-client/src/modules/transfers.ts of TelegramFileManager (same
// function and type names), plus `remove` (`transfers.remove`).
import type { HttpClient, PagedQuery, Paged } from '../http';
import type {
  StartDownloadRequest,
  StartUploadRequest,
  TransferAcceptedDto,
  TransferClearQuery,
  TransferDto,
  TransferListQuery,
  TransferQueueScope,
  TransfersSnapshotDto,
  TransferSummaryDto
} from '../types/transfers';

const BASE = '/api/v1/transfers';
const enc = encodeURIComponent;

/** Downloads, uploads and batch tasks of the server. */
export function createTransfersApi(http: HttpClient) {
  return {
    /** GET /api/v1/transfers: everything in flight plus the summary. */
    snapshot: (signal?: AbortSignal) => http.get<TransfersSnapshotDto>(BASE, { signal }),
    /** GET /api/v1/transfers/summary */
    summary: (signal?: AbortSignal) => http.get<TransferSummaryDto>(`${BASE}/summary`, { signal }),
    /** GET /api/v1/transfers/downloads (paged) */
    downloads: (query: TransferListQuery = {}, signal?: AbortSignal): Promise<Paged<TransferDto>> =>
      http.getPaged<TransferDto>(`${BASE}/downloads`, { query: { ...query }, signal }),
    /** GET /api/v1/transfers/uploads (paged) */
    uploads: (query: TransferListQuery = {}, signal?: AbortSignal): Promise<Paged<TransferDto>> =>
      http.getPaged<TransferDto>(`${BASE}/uploads`, { query: { ...query }, signal }),
    /** GET /api/v1/transfers/tasks (paged) */
    tasks: (query: PagedQuery = {}, signal?: AbortSignal): Promise<Paged<TransferDto>> =>
      http.getPaged<TransferDto>(`${BASE}/tasks`, { query: { ...query }, signal }),
    /** GET /api/v1/transfers/{id} */
    get: (id: string, signal?: AbortSignal) => http.get<TransferDto>(`${BASE}/${enc(id)}`, { signal }),
    /** POST /api/v1/transfers/downloads (202): downloads indexed files/folders to the local storage. */
    startDownload: (body: StartDownloadRequest, signal?: AbortSignal) =>
      http.post<TransferAcceptedDto>(`${BASE}/downloads`, body, { signal }),
    /** POST /api/v1/transfers/uploads (202): pushes local files/folders to a channel. */
    startUpload: (body: StartUploadRequest, signal?: AbortSignal) =>
      http.post<TransferAcceptedDto>(`${BASE}/uploads`, body, { signal }),
    /** POST /api/v1/transfers/downloads/pause: pauses the download queue globally. */
    pauseDownloads: () => http.post<TransferSummaryDto>(`${BASE}/downloads/pause`),
    /** POST /api/v1/transfers/downloads/resume */
    resumeDownloads: () => http.post<TransferSummaryDto>(`${BASE}/downloads/resume`),
    /** POST /api/v1/transfers/downloads/stop */
    stopDownloads: () => http.post<TransferSummaryDto>(`${BASE}/downloads/stop`),
    /** POST /api/v1/transfers/{id}/cancel (a batch task also cancels what it spawned) */
    cancel: (id: string) => http.post<void>(`${BASE}/${enc(id)}/cancel`),
    /** POST /api/v1/transfers/{id}/pause (running downloads only) */
    pause: (id: string) => http.post<void>(`${BASE}/${enc(id)}/pause`),
    /** POST /api/v1/transfers/{id}/retry (downloads and batch tasks; also resumes a paused one) */
    retry: (id: string) => http.post<void>(`${BASE}/${enc(id)}/retry`),
    /** DELETE /api/v1/transfers/{id} (`transfers.remove`): drops a finished/paused/queued entry; 409 while running. */
    remove: (id: string) => http.delete<void>(`${BASE}/${enc(id)}`),
    /** POST /api/v1/transfers/clear: removes finished entries; `states` is sent comma separated. */
    clear: (query: TransferClearQuery = {}) =>
      http.post<TransfersSnapshotDto>(`${BASE}/clear`, undefined, {
        query: { scope: query.scope, states: query.states?.length ? query.states.join(',') : undefined }
      }),
    /** POST /api/v1/transfers/queue/clear: empties a queue without touching what runs. */
    clearQueue: (scope: TransferQueueScope = 'all') =>
      http.post<TransfersSnapshotDto>(`${BASE}/queue/clear`, undefined, { query: { scope } })
  };
}

export type TransfersApi = ReturnType<typeof createTransfersApi>;
