// Mirrors ClientApp/packages/api-client/src/modules/shares.ts of TelegramFileManager (same
// function and type names; the STRM and import calls are left out, this app only browses).
import type { HttpClient, Paged } from '../http';
import type { ShareExportQuery, SharedCollectionDto, ShareFilesModel, SharesListQuery } from '../types/shares';

const BASE = '/api/v1/shares';
const enc = encodeURIComponent;

/** Shared collections imported from other instances. */
export function createSharesApi(http: HttpClient) {
  return {
    /** GET /api/v1/shares (paged, newest first) */
    list: (query: SharesListQuery = {}, signal?: AbortSignal): Promise<Paged<SharedCollectionDto>> =>
      http.getPaged<SharedCollectionDto>(BASE, { query: { ...query }, signal }),
    /** GET /api/v1/shares/{id} */
    get: (id: string, signal?: AbortSignal) => http.get<SharedCollectionDto>(`${BASE}/${enc(id)}`, { signal }),
    /** GET /api/v1/shares/export: builds a share payload for a channel folder. */
    export: (query: ShareExportQuery, signal?: AbortSignal) =>
      http.get<ShareFilesModel>(`${BASE}/export`, { query: { ...query }, signal })
  };
}

export type SharesApi = ReturnType<typeof createSharesApi>;
