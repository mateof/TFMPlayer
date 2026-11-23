import { useMemo } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { FileBrowser, type FileSource } from '@/components/files/FileBrowser';
import { Header } from '@/components/layout/Header';
import { LoadingScreen } from '@/components/common/Spinner';
import { useServerFeatures } from '@/hooks/useServerFeatures';
import { getV1Api } from '@/services/api/v1';
import { createChannelTarget } from '@/services/files/fileManager';
import { t } from '@/i18n';

interface FolderBreadcrumb {
  id: string;
  name: string;
}

function parseBreadcrumbs(raw: string | null): FolderBreadcrumb[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(decodeURIComponent(raw));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** Read-only browser of one shared collection (files live in another account's channel). */
export function SharedCollectionPage() {
  const { id = '' } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { features, loaded } = useServerFeatures();
  const supported = features.has('shares.browse') && features.has('files.content');

  const collectionQuery = useQuery({
    queryKey: ['shares', 'one', id],
    queryFn: async ({ signal }) => (await getV1Api()).shares.get(id, signal),
    enabled: supported && !!id,
    retry: false
  });
  const collection = collectionQuery.data;

  const currentFolderId = searchParams.get('folder') || '';
  const pathParam = searchParams.get('path');
  const folderPath = useMemo(() => parseBreadcrumbs(pathParam), [pathParam]);

  const manager = useMemo(
    () => (collection?.channelId && collection.collectionId
      ? createChannelTarget(collection.channelId, features, collection.collectionId)
      : null),
    [collection, features]
  );

  // Never used: a shared collection is always shown in Manage mode
  const source = useMemo<FileSource>(() => ({
    key: `share:${id}`,
    location: currentFolderId,
    fetchPage: async () => ({ files: [], totalCount: 0, hasMore: false }),
    toTrack: () => {
      throw new Error('Shared collections do not play into the queue');
    },
    collectFolder: async () => [],
    folderDragItem: (file) => ({ kind: 'local-folder', path: file.path, name: file.name })
  }), [id, currentFolderId]);

  const openFolder = (folder: FolderBreadcrumb) => {
    const params = new URLSearchParams(searchParams);
    params.set('folder', folder.id);
    params.set('path', encodeURIComponent(JSON.stringify([...folderPath, folder])));
    setSearchParams(params);
  };

  const navigateBreadcrumb = (index: number) => {
    const params = new URLSearchParams(searchParams);
    if (index === -1) {
      params.delete('folder');
      params.delete('path');
    } else {
      const newPath = folderPath.slice(0, index + 1);
      params.set('folder', newPath[newPath.length - 1].id);
      params.set('path', encodeURIComponent(JSON.stringify(newPath)));
    }
    setSearchParams(params);
  };

  if (!loaded || (supported && collectionQuery.isPending)) {
    return (
      <div className="flex flex-col h-full">
        <Header title={t('Shared collection')} showBack backPath="/shares" />
        <LoadingScreen message={t('Loading...')} />
      </div>
    );
  }

  if (!supported || !manager) {
    return (
      <div className="flex flex-col h-full">
        <Header title={t('Shared collection')} showBack backPath="/shares" />
        <p className="px-6 py-12 text-center text-slate-400" role="alert">
          {!supported ? t('This server cannot browse shared collections') : t('Could not open this shared collection')}
        </p>
      </div>
    );
  }

  return (
    <FileBrowser
      source={source}
      title={collection?.name || t('Shared collection')}
      subtitle={(total) => `${t('{count} files', { count: total })} · ${t('read only')}`}
      backPath="/shares"
      breadcrumbs={folderPath.map((f) => f.name)}
      onNavigateBreadcrumb={navigateBreadcrumb}
      onOpenFolder={(file) => openFolder({ id: file.id, name: file.name })}
      manager={manager}
      manageOnly
    />
  );
}
