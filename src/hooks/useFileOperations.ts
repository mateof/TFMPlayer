import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { confirmDialog } from '@/components/common/confirm';
import { useUiStore } from '@/stores/uiStore';
import { isApiError } from '@/services/api/v1';
import { useFileClipboard } from '@/services/files/clipboard';
import { enqueueUploads } from '@/services/files/uploadQueue';
import {
  saveBlob, triggerDownload,
  type FileManagerTarget, type FolderContext, type FolderRef
} from '@/services/files/fileManager';
import type { ChannelFile } from '@/types/models';
import { t } from '@/i18n';

/** User-facing text for a failed operation. */
export function operationErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 409) return t('An item with that name already exists there');
    if (error.status === 404) return t('The server does not support this action. Update TelegramFileManager.');
    if (error.status === 403) return t('The server does not allow this action');
    if (error.code === 'network_error') return t('Could not reach the server');
    if (error.message) return error.message;
  }
  return t('Could not complete the action');
}

function skippedSuffix(result: { skipped?: string[] } | void): string {
  const skipped = result && result.skipped ? result.skipped.length : 0;
  return skipped > 0 ? ` ${t('({count} skipped)', { count: skipped })}` : '';
}

/**
 * The file operations of Manage mode with their confirmations, toasts and
 * list refreshes. Callers decide which ones to show from `target.operations`.
 */
export function useFileOperations(target: FileManagerTarget | null, ctx: FolderContext) {
  const queryClient = useQueryClient();
  const addToast = useUiStore((s) => s.addToast);
  const setClip = useFileClipboard((s) => s.set);
  const clearClip = useFileClipboard((s) => s.clear);

  const refresh = useCallback(() => {
    if (!target) return;
    queryClient.invalidateQueries({ queryKey: ['manage-files', target.key] });
    queryClient.invalidateQueries({ queryKey: ['folder-picker', target.key] });
    // The audio-only listing of the same place
    queryClient.invalidateQueries({ queryKey: ['files'] });
  }, [queryClient, target]);

  const run = useCallback(async <T,>(action: () => Promise<T>, success?: (result: T) => string): Promise<T | undefined> => {
    try {
      const result = await action();
      if (success) addToast(success(result), 'success');
      return result;
    } catch (error) {
      console.error('File operation failed:', error);
      addToast(operationErrorMessage(error), 'error');
      return undefined;
    }
  }, [addToast]);

  return useMemo(() => ({
    refresh,

    /** Throws so the name dialog can show the error inline. */
    async createFolder(name: string) {
      if (!target) return;
      try {
        await target.createFolder(ctx, name);
      } catch (error) {
        throw new Error(operationErrorMessage(error), { cause: error });
      }
      addToast(t('Folder "{name}" created', { name }), 'success');
      refresh();
    },

    async rename(file: ChannelFile, newName: string) {
      if (!target || newName === file.name) return;
      try {
        await target.rename(file, newName);
      } catch (error) {
        throw new Error(operationErrorMessage(error), { cause: error });
      }
      addToast(t('Renamed to "{name}"', { name: newName }), 'success');
      refresh();
    },

    async remove(files: ChannelFile[]): Promise<boolean> {
      if (!target || files.length === 0) return false;
      const ok = await confirmDialog({
        title: files.length === 1 ? t('Delete "{name}"?', { name: files[0].name }) : t('Delete {count} items?', { count: files.length }),
        message: target.kind === 'channel'
          ? t('Folders are deleted with everything inside. The Telegram messages are deleted too, to free the channel storage. This cannot be undone.')
          : t('Folders are deleted with everything inside. This cannot be undone.'),
        confirmLabel: t('Delete'),
        danger: true
      });
      if (!ok) return false;
      const result = await run(() => target.remove(files), (r) => t('{count} item(s) deleted', { count: r?.accepted ?? files.length }) + skippedSuffix(r));
      refresh();
      return result !== undefined;
    },

    toClipboard(mode: 'cut' | 'copy', files: ChannelFile[]) {
      if (!target || files.length === 0) return;
      setClip({ mode, targetKey: target.key, fromLocation: ctx.location, files });
      addToast(
        mode === 'cut'
          ? t('{count} item(s) cut. Open the destination folder and paste.', { count: files.length })
          : t('{count} item(s) copied. Open the destination folder and paste.', { count: files.length }),
        'info'
      );
    },

    async paste(destination: FolderRef) {
      const clip = useFileClipboard.getState().clip;
      if (!target || !clip || clip.targetKey !== target.key) return;
      const action = clip.mode === 'cut' ? target.move : target.copy;
      const result = await run(
        () => action(clip.files, destination),
        (r) => (clip.mode === 'cut'
          ? t('{count} item(s) moved', { count: r?.accepted ?? clip.files.length })
          : t('{count} item(s) copied', { count: r?.accepted ?? clip.files.length })) + skippedSuffix(r)
      );
      if (result !== undefined && clip.mode === 'cut') clearClip();
      refresh();
    },

    clearClipboard: clearClip,

    downloadToDevice(files: ChannelFile[]) {
      if (!target) return;
      const downloadable = files.filter((f) => f.category !== 'Folder');
      if (downloadable.length === 0) {
        addToast(t('Folders cannot be downloaded to the device; download them to the server instead'), 'info');
        return;
      }
      // Browsers block bursts of downloads: space them out a little
      downloadable.forEach((file, i) => {
        const url = target.contentUrl(file, true);
        if (url) setTimeout(() => triggerDownload(url, file.name), i * 400);
      });
      addToast(t('Downloading {count} file(s) to this device', { count: downloadable.length }), 'info');
    },

    async downloadToServer(files: ChannelFile[]) {
      if (!target || files.length === 0) return;
      await run(() => target.downloadToServer(files), (r) =>
        t('{count} item(s) queued on the server. Follow them in Transfers.', { count: r?.accepted ?? files.length }) + skippedSuffix(r)
      );
    },

    async preload(files: ChannelFile[]) {
      if (!target || files.length === 0) return;
      await run(() => target.preload(files), (r) =>
        t('Preloading {count} item(s) into the server cache', { count: r?.accepted ?? files.length })
      );
    },

    async shareLink(file: ChannelFile) {
      if (!target) return;
      const url = target.contentUrl(file);
      if (!url) return;
      const ok = await confirmDialog({
        title: t('Share a link to "{name}"?', { name: file.name }),
        message: t('The link includes your API key: whoever gets it can use your server. Share it only with people you trust.'),
        confirmLabel: t('Share link')
      });
      if (!ok) return;
      try {
        if (typeof navigator.share === 'function') {
          await navigator.share({ title: file.name, url });
          return;
        }
        await navigator.clipboard.writeText(url);
        addToast(t('Link copied to the clipboard'), 'success');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        addToast(t('Could not share the link'), 'error');
      }
    },

    async exportShare(folder: ChannelFile | null, label: string) {
      if (!target) return;
      const blob = await run(() => target.exportShare(folder, label));
      if (!blob) return;
      saveBlob(blob, `${label.replace(/[\\/:*?"<>|]+/g, '_') || 'share'}.json`);
      addToast(t('Share file saved. Import it on another server to see these files there.'), 'success');
    },

    upload(files: File[]) {
      if (!target || files.length === 0) return;
      enqueueUploads(target, ctx, files, () => refresh());
      addToast(
        target.kind === 'channel'
          ? t('Uploading {count} file(s). The server then sends them to Telegram (see Transfers).', { count: files.length })
          : t('Uploading {count} file(s)', { count: files.length }),
        'info'
      );
    }
  }), [target, ctx, refresh, run, addToast, setClip, clearClip]);
}

export type FileOperations = ReturnType<typeof useFileOperations>;
