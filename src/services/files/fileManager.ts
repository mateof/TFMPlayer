/**
 * "Manage" mode of the file browser: every file type, file operations and
 * viewers, through the v1 API. A target wraps one place files live in (a
 * channel index, the server's local storage or a shared collection) and says
 * which operations the connected server supports, so the UI only offers what
 * will work. Old servers (no `files.content`) never get here and keep the
 * audio-only browser.
 */
import { getV1Api, peekV1Api, type ApiClient } from '@/services/api/v1';
import type { ApiFileDto, BrowseQuery, TransferAcceptedDto } from '@/services/api/v1';
import type { ServerFeature } from '@/services/server/capabilities';
import type { ChannelFile, FileCategory } from '@/types/models';

export type ManageKind = 'channel' | 'local' | 'share';

/** v1 category filters offered in Manage mode. */
export const MANAGE_FILTERS = ['all', 'audio', 'video', 'photo', 'document', 'archive'] as const;
export type ManageFilter = (typeof MANAGE_FILTERS)[number];

/** Labels (i18n keys) of the Manage mode type filter. */
export const MANAGE_FILTER_LABELS: Record<ManageFilter, string> = {
  all: 'All files',
  audio: 'Audio',
  video: 'Video',
  photo: 'Photos',
  document: 'Documents',
  archive: 'Archives'
};

/** Problem with a new name (create folder / rename), or null when it is fine. Returns an i18n key. */
export function entryNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Enter a name';
  if (/[/\\]/.test(trimmed)) return 'The name cannot contain / or \\';
  if (trimmed === '.' || trimmed === '..') return 'That name is not allowed';
  return null;
}

export interface ManageListParams {
  pageSize: number;
  filter: ManageFilter;
  search?: string;
  sortBy: string;
  sortDesc: boolean;
}

export interface ManagePage {
  files: ChannelFile[];
  totalCount: number;
  hasMore: boolean;
  /** Folder path of the listed folder (channels: needed to create folders and upload). */
  currentPath: string;
}

/** Where the browser is: `location` is a folder id (channels) or a relative path (local). */
export interface FolderContext {
  location: string;
  currentPath: string;
}

export type ManageOperation =
  | 'createFolder'
  | 'rename'
  | 'delete'
  | 'copy'
  | 'move'
  | 'upload'
  | 'downloadToDevice'
  | 'downloadToServer'
  | 'preload'
  | 'shareLink'
  | 'exportShare';

export interface FileManagerTarget {
  kind: ManageKind;
  /** Clipboard / cache key: only entries of the same target can be pasted together. */
  key: string;
  /** Operations available with the current server. */
  operations: ReadonlySet<ManageOperation>;
  thumbnails: boolean;
  list(location: string, page: number, params: ManageListParams, signal?: AbortSignal): Promise<ManagePage>;
  createFolder(ctx: FolderContext, name: string): Promise<void>;
  rename(file: ChannelFile, newName: string): Promise<void>;
  remove(files: ChannelFile[]): Promise<TransferAcceptedDto | void>;
  copy(files: ChannelFile[], target: FolderRef): Promise<TransferAcceptedDto | void>;
  move(files: ChannelFile[], target: FolderRef): Promise<TransferAcceptedDto | void>;
  upload(ctx: FolderContext, file: File, options: { signal?: AbortSignal; onProgress?: (loaded: number, total: number) => void }): Promise<void>;
  downloadToServer(files: ChannelFile[]): Promise<TransferAcceptedDto | void>;
  preload(files: ChannelFile[]): Promise<{ accepted: number } | void>;
  exportShare(folder: ChannelFile | null, name: string): Promise<Blob>;
  /** Inline URL (viewers) or attachment URL (download), with the API key. */
  contentUrl(file: ChannelFile, attachment?: boolean): string | undefined;
  /** What to give a `<video>`/`<audio>` (transcoding stream for mkv, avi...). */
  playbackUrl(file: ChannelFile): string | undefined;
  thumbnailUrl(file: ChannelFile): string | undefined;
}

/** A destination folder chosen in the folder picker. */
export interface FolderRef {
  /** Channel folder id or local relative path; '' is the root. */
  location: string;
  /** Channel folder path (`/a/b/`) or local relative path. */
  path: string;
  name: string;
}

// ---- Conversion ----------------------------------------------------------------

const KNOWN_CATEGORIES = new Set<FileCategory>(['Audio', 'Video', 'Document', 'Photo', 'Folder', 'Archive', 'Application', 'Other']);

/** Local paths in v1 are relative to the root, without a leading slash. */
export function toLocalV1Path(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
}

/** ApiFileDto -> the ChannelFile the browser renders. */
export function apiFileToChannelFile(dto: ApiFileDto, kind: ManageKind): ChannelFile {
  const category = (KNOWN_CATEGORIES.has(dto.category as FileCategory) ? dto.category : dto.isFile ? 'Other' : 'Folder') as FileCategory;
  // Local entries are addressed by their path, written like the mobile API
  // does ('/music/a.mp3'), so ids (downloads, playlists) match in both modes
  const localPath = kind === 'local' ? `/${toLocalV1Path(dto.id)}` : '';
  return {
    id: kind === 'local' ? localPath : dto.id,
    name: dto.name,
    path: kind === 'local' ? localPath : dto.path,
    folderPath: dto.path,
    parentId: dto.parentId ?? '',
    size: dto.size,
    sizeText: dto.sizeText,
    type: dto.type,
    category,
    dateCreated: dto.dateCreated,
    dateModified: dto.dateModified,
    messageId: dto.messageId ?? undefined,
    isFile: dto.isFile,
    hasChildren: dto.hasChildren,
    isSplit: dto.isSplit,
    md5Hash: dto.md5Hash,
    xxHash: dto.xxHash,
    contentUrl: dto.contentUrl ?? undefined,
    contentDownloadUrl: dto.contentDownloadUrl ?? undefined,
    playbackUrl: dto.playbackUrl ?? undefined,
    thumbnailUrl: dto.thumbnailUrl ?? undefined
  };
}

/** Full path of an entry for the details panel. */
export function displayPath(file: ChannelFile, kind: ManageKind): string {
  if (kind === 'local') return `/${toLocalV1Path(file.path)}`;
  const folder = file.folderPath ?? file.path ?? '/';
  return `${folder.endsWith('/') ? folder : `${folder}/`}${file.name}`;
}

// ---- Viewers ---------------------------------------------------------------------

export type ViewerKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | null;

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'avif', 'svg', 'heic']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mkv', 'mov', 'm4v', 'avi', 'wmv', 'flv', '3gp', 'ts', 'mts', 'm2ts', 'ogv']);
const TEXT_EXT = new Set(['txt', 'md', 'log', 'json', 'xml', 'csv', 'srt', 'vtt', 'nfo', 'ini', 'yml', 'yaml', 'cue', 'm3u']);

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

/** How a file can be shown in the app (null: only download/details). */
export function viewerKind(file: ChannelFile): ViewerKind {
  if (file.category === 'Folder') return null;
  const ext = extensionOf(file.name);
  if (file.category === 'Photo' || IMAGE_EXT.has(ext)) return 'image';
  if (file.category === 'Video' || VIDEO_EXT.has(ext)) return 'video';
  if (file.category === 'Audio') return 'audio';
  if (ext === 'pdf') return 'pdf';
  if (TEXT_EXT.has(ext)) return 'text';
  return null;
}

// ---- Capability gating -------------------------------------------------------------

/** Which operations a target offers with the given server features. */
export function operationsFor(kind: ManageKind, features: ReadonlySet<string>): Set<ManageOperation> {
  const ops = new Set<ManageOperation>();
  if (!features.has('files.content')) return ops;
  const has = (f: ServerFeature) => features.has(f);
  ops.add('downloadToDevice');
  ops.add('shareLink');
  if (kind === 'share') {
    // Read-only: browse, view, save to the device or to the server
    ops.add('downloadToServer');
    return ops;
  }
  ops.add('createFolder');
  ops.add('rename');
  ops.add('delete');
  ops.add('upload');
  if (kind === 'channel') {
    ops.add('copy');
    ops.add('move');
    ops.add('downloadToServer');
    if (has('files.preload')) ops.add('preload');
    if (has('shares.browse')) ops.add('exportShare');
  } else if (has('local.copyMove')) {
    ops.add('copy');
    ops.add('move');
  }
  return ops;
}

// ---- Targets ---------------------------------------------------------------------------

function api(): Promise<ApiClient> {
  return getV1Api();
}

function toQuery(page: number, params: ManageListParams): BrowseQuery {
  return {
    page,
    pageSize: params.pageSize,
    filter: params.filter,
    search: params.search,
    sortBy: params.sortBy,
    sortDescending: params.sortDesc
  };
}

function unsupported(): never {
  throw new Error('Operation not supported here');
}

function fileIds(files: ChannelFile[]): string[] {
  return files.map((f) => f.id);
}

/** Channel index (`/api/v1/channels/{id}/files`), or a shared collection when `collectionId` is set. */
export function createChannelTarget(channelId: string, features: ReadonlySet<string>, collectionId?: string): FileManagerTarget {
  const kind: ManageKind = collectionId ? 'share' : 'channel';
  const operations = operationsFor(kind, features);
  const content = (file: ChannelFile, attachment = false) => {
    const client = peekV1Api();
    if (!client || !file.isFile) return undefined;
    const fromServer = attachment ? file.contentDownloadUrl : file.contentUrl;
    return fromServer
      ? client.http.authUrl(fromServer)
      : client.files.contentUrl(channelId, file.id, { attachment, collectionId });
  };

  return {
    kind,
    key: collectionId ? `share:${collectionId}` : `channel:${channelId}`,
    operations,
    thumbnails: features.has('files.thumbnails'),

    async list(location, page, params, signal) {
      const client = await api();
      const { contents, page: info } = await client.files.list(
        channelId,
        { ...toQuery(page, params), folderId: location || undefined, path: location ? undefined : '/', collectionId },
        signal
      );
      return {
        files: (contents?.items ?? []).map((dto) => apiFileToChannelFile(dto, kind)),
        totalCount: info.totalItems,
        hasMore: info.hasNext,
        currentPath: contents?.currentPath ?? '/'
      };
    },

    async createFolder(ctx, name) {
      if (!operations.has('createFolder')) unsupported();
      await (await api()).files.createFolder(channelId, { path: ctx.currentPath || '/', name });
    },
    async rename(file, newName) {
      if (!operations.has('rename')) unsupported();
      await (await api()).files.rename(channelId, file.id, { newName });
    },
    async remove(files) {
      if (!operations.has('delete')) unsupported();
      return (await api()).files.delete(channelId, { ids: fileIds(files) });
    },
    async copy(files, target) {
      if (!operations.has('copy')) unsupported();
      return (await api()).files.copy(channelId, { ids: fileIds(files), ...channelTargetBody(target) });
    },
    async move(files, target) {
      if (!operations.has('move')) unsupported();
      return (await api()).files.move(channelId, { ids: fileIds(files), ...channelTargetBody(target) });
    },
    async upload(ctx, file, options) {
      if (!operations.has('upload')) unsupported();
      await (await api()).files.upload(channelId, file, { path: ctx.currentPath || '/', ...options });
    },
    async downloadToServer(files) {
      if (!operations.has('downloadToServer')) unsupported();
      return (await api()).transfers.startDownload({
        channelId,
        fileIds: fileIds(files),
        targetPath: null,
        sharedCollectionId: collectionId ?? null
      });
    },
    async preload(files) {
      if (!operations.has('preload')) unsupported();
      return (await api()).files.preload(channelId, { fileIds: fileIds(files) });
    },
    async exportShare(folder, name) {
      if (!operations.has('exportShare')) unsupported();
      const payload = await (await api()).shares.export({ channelId, folderId: folder?.id, name });
      return new Blob([JSON.stringify(payload)], { type: 'application/json' });
    },

    contentUrl: content,
    playbackUrl(file) {
      const client = peekV1Api();
      if (!client || !file.isFile) return undefined;
      return file.playbackUrl ? client.http.authUrl(file.playbackUrl) : content(file);
    },
    thumbnailUrl(file) {
      const client = peekV1Api();
      if (!client || !file.thumbnailUrl || !features.has('files.thumbnails')) return undefined;
      return client.http.authUrl(file.thumbnailUrl);
    }
  };
}

function channelTargetBody(target: FolderRef): { targetFolderId?: string; targetPath?: string } {
  return target.location ? { targetFolderId: target.location } : { targetPath: '/' };
}

/** The server's local storage (`/api/v1/local`). */
export function createLocalTarget(features: ReadonlySet<string>): FileManagerTarget {
  const operations = operationsFor('local', features);
  const content = (file: ChannelFile, attachment = false) => {
    const client = peekV1Api();
    if (!client || !file.isFile) return undefined;
    return client.local.downloadUrl(toLocalV1Path(file.path), !attachment);
  };

  return {
    kind: 'local',
    key: 'local',
    operations,
    thumbnails: false,

    async list(location, page, params, signal) {
      const client = await api();
      const { contents, page: info } = await client.local.list(
        { ...toQuery(page, params), path: toLocalV1Path(location) || undefined },
        signal
      );
      return {
        files: (contents?.items ?? []).map((dto) => apiFileToChannelFile(dto, 'local')),
        totalCount: info.totalItems,
        hasMore: info.hasNext,
        currentPath: contents?.currentPath ?? toLocalV1Path(location)
      };
    },

    async createFolder(ctx, name) {
      if (!operations.has('createFolder')) unsupported();
      await (await api()).local.createFolder({ path: toLocalV1Path(ctx.location), name });
    },
    async rename(file, newName) {
      if (!operations.has('rename')) unsupported();
      await (await api()).local.rename({ path: toLocalV1Path(file.path), newName });
    },
    async remove(files) {
      if (!operations.has('delete')) unsupported();
      return (await api()).local.delete({ paths: files.map((f) => toLocalV1Path(f.path)) });
    },
    async copy(files, target) {
      if (!operations.has('copy')) unsupported();
      return (await api()).local.copy({ paths: files.map((f) => toLocalV1Path(f.path)), targetPath: toLocalV1Path(target.path) });
    },
    async move(files, target) {
      if (!operations.has('move')) unsupported();
      return (await api()).local.move({ paths: files.map((f) => toLocalV1Path(f.path)), targetPath: toLocalV1Path(target.path) });
    },
    async upload(ctx, file, options) {
      if (!operations.has('upload')) unsupported();
      const path = toLocalV1Path(ctx.location);
      await (await api()).local.upload(file, { path: path || undefined, ...options });
    },
    downloadToServer: async () => unsupported(),
    preload: async () => unsupported(),
    exportShare: async () => unsupported(),

    contentUrl: content,
    playbackUrl: (file) => content(file),
    thumbnailUrl: () => undefined
  };
}

/** Folder entries of a listing, for the folder picker (folders always sort first). */
export async function listFolders(target: FileManagerTarget, location: string, signal?: AbortSignal): Promise<{ folders: ChannelFile[]; currentPath: string }> {
  const folders: ChannelFile[] = [];
  let currentPath = '/';
  for (let page = 1; page <= 20; page++) {
    const result = await target.list(location, page, { pageSize: 200, filter: 'all', sortBy: 'name', sortDesc: false }, signal);
    currentPath = result.currentPath;
    const pageFolders = result.files.filter((f) => f.category === 'Folder');
    folders.push(...pageFolders);
    // Once files start, there are no more folders
    if (!result.hasMore || pageFolders.length < result.files.length) break;
  }
  return { folders, currentPath };
}

/** Starts a browser download of a URL (the server sends Content-Disposition: attachment). */
export function triggerDownload(url: string, fileName?: string): void {
  const a = document.createElement('a');
  a.href = url;
  if (fileName) a.download = fileName;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Saves a Blob made in the app as a file on the device. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, fileName);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
