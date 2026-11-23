import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { FileBrowser, type FileSource } from '@/components/files/FileBrowser';
import { localFilesApi } from '@/services/api/localFiles.api';
import { collectLocalFolderTracks, localFileToTrack } from '@/utils/collectTracks';
import { t } from '@/i18n';

interface FolderBreadcrumb {
  path: string;
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

/** Files in the server's local directory, browsed like a channel. */
export function LocalFilesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const pathParam = searchParams.get('path') || '';
  const breadcrumbsParam = searchParams.get('breadcrumbs');
  const folderPath = useMemo(() => parseBreadcrumbs(breadcrumbsParam), [breadcrumbsParam]);

  const source = useMemo<FileSource>(() => ({
    key: 'local',
    location: pathParam,
    fetchPage: (page, params) => localFilesApi.getFiles(pathParam, { page, ...params }),
    toTrack: localFileToTrack,
    collectFolder: (file, onProgress) => collectLocalFolderTracks(file.path, onProgress),
    folderDragItem: (file) => ({ kind: 'local-folder', path: file.path, name: file.name })
  }), [pathParam]);

  const openFolder = (folder: FolderBreadcrumb) => {
    const params = new URLSearchParams(searchParams);
    params.set('path', folder.path);
    params.set('breadcrumbs', encodeURIComponent(JSON.stringify([...folderPath, folder])));
    setSearchParams(params);
  };

  const navigateBreadcrumb = (index: number) => {
    const params = new URLSearchParams(searchParams);
    if (index === -1) {
      params.delete('path');
      params.delete('breadcrumbs');
    } else {
      const newPath = folderPath.slice(0, index + 1);
      params.set('path', newPath[newPath.length - 1].path);
      params.set('breadcrumbs', encodeURIComponent(JSON.stringify(newPath)));
    }
    setSearchParams(params);
  };

  return (
    <FileBrowser
      source={source}
      title={folderPath.length > 0 ? folderPath[folderPath.length - 1].name : t('Local Files')}
      backPath="/channels?tab=local"
      breadcrumbs={folderPath.map((f) => f.name)}
      onNavigateBreadcrumb={navigateBreadcrumb}
      onOpenFolder={(file) => openFolder({ path: file.path, name: file.name })}
    />
  );
}
