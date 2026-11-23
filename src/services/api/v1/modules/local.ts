// Mirrors ClientApp/packages/api-client/src/modules/local.ts of TelegramFileManager (same
// function and type names), plus copy/move (`local.copyMove`) and upload progress.
import type { HttpClient } from '../http';
import type {
  ApiFileDto,
  BrowseQuery,
  FolderContentsPage,
  LocalCopyMoveRequest,
  LocalCreateFolderRequest,
  LocalDeleteRequest,
  LocalRenameRequest
} from '../types/files';
import type { DirectorySizeModel, LocalPathQuery, LocalSizeQuery } from '../types/local';
import type { TransferAcceptedDto } from '../types/transfers';
import { browseFolder, uploadForm, type UploadProgressOptions } from './files';

const BASE = '/api/v1/local';

/** The server local storage (download target, upload source). Paths are relative to the local root. */
export function createLocalApi(http: HttpClient) {
  return {
    /** GET /api/v1/local (paged: `contents.items` is the current page; `path` selects the folder) */
    list: (query: BrowseQuery = {}, signal?: AbortSignal): Promise<FolderContentsPage> => browseFolder(http, BASE, query, signal),
    /** GET /api/v1/local/info?path= */
    info: (query: LocalPathQuery, signal?: AbortSignal) => http.get<ApiFileDto>(`${BASE}/info`, { query: { ...query }, signal }),
    /** GET /api/v1/local/size?path=: size and per extension breakdown of a folder tree (can be slow). */
    size: (query: LocalSizeQuery = {}, signal?: AbortSignal) =>
      http.get<DirectorySizeModel>(`${BASE}/size`, { query: { ...query }, signal }),
    /** POST /api/v1/local/folders (201) */
    createFolder: (body: LocalCreateFolderRequest) => http.post<ApiFileDto>(`${BASE}/folders`, body),
    /** POST /api/v1/local/rename */
    rename: (body: LocalRenameRequest) => http.post<ApiFileDto>(`${BASE}/rename`, body),
    /** POST /api/v1/local/delete */
    delete: (body: LocalDeleteRequest) => http.post<TransferAcceptedDto>(`${BASE}/delete`, body),
    /** POST /api/v1/local/copy (`local.copyMove`): skips name clashes unless `overwrite`. */
    copy: (body: LocalCopyMoveRequest) => http.post<TransferAcceptedDto>(`${BASE}/copy`, body),
    /** POST /api/v1/local/move (`local.copyMove`) */
    move: (body: LocalCopyMoveRequest) => http.post<TransferAcceptedDto>(`${BASE}/move`, body),
    /** GET /api/v1/local/download?path= with `?apiKey=` (inline for viewing, attachment to save). */
    downloadUrl: (path: string, inline = false) =>
      http.authUrl(`${BASE}/download`, { path, disposition: inline ? 'inline' : undefined }),
    /** POST /api/v1/local/upload (multipart, 201): stores a device file under `options.path`. */
    upload: (file: Blob, options: UploadProgressOptions = {}) =>
      http.upload<ApiFileDto>(`${BASE}/upload`, uploadForm(file, options), { signal: options.signal, onProgress: options.onProgress }),
    /** POST /api/v1/local/cache/clear: empties the streaming/temporary cache. */
    clearCache: () => http.post<void>(`${BASE}/cache/clear`)
  };
}

export type LocalApi = ReturnType<typeof createLocalApi>;
