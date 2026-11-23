import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';

import { AppShell } from '@/components/layout/AppShell';
import { LoadingScreen } from '@/components/common/Spinner';
import { PWAUpdatePrompt } from '@/components/common/PWAUpdatePrompt';
import { ThemeController } from '@/theme/ThemeController';

import { isServerConfigured, requestPersistentStorage } from '@/db/database';
import { useSettingsStore } from '@/stores/settingsStore';
import { playlistSyncService } from '@/services/sync/PlaylistSyncService';
import { audioPlayer } from '@/services/audio/AudioPlayerService';
import { storageService } from '@/services/storage/StorageService';
import { queryClient, queryPersister, PERSIST_MAX_AGE, QUERY_CACHE_BUSTER } from '@/services/query/queryClient';
import { t } from '@/i18n';

// Every screen is its own chunk: the first load only downloads the shell
// and the screen being opened
const named = <K extends string>(loader: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => loader().then((m) => ({ default: m[name] })));

const SetupPage = named(() => import('@/pages/SetupPage'), 'SetupPage');
const ChannelsPage = named(() => import('@/pages/ChannelsPage'), 'ChannelsPage');
const ChannelDetailPage = named(() => import('@/pages/ChannelDetailPage'), 'ChannelDetailPage');
const LocalFilesPage = named(() => import('@/pages/LocalFilesPage'), 'LocalFilesPage');
const PlaylistsPage = named(() => import('@/pages/PlaylistsPage'), 'PlaylistsPage');
const PlaylistDetailPage = named(() => import('@/pages/PlaylistDetailPage'), 'PlaylistDetailPage');
const SmartPlaylistPage = named(() => import('@/pages/SmartPlaylistPage'), 'SmartPlaylistPage');
const DownloadsPage = named(() => import('@/pages/DownloadsPage'), 'DownloadsPage');
const StoragePage = named(() => import('@/pages/StoragePage'), 'StoragePage');
const SettingsPage = named(() => import('@/pages/SettingsPage'), 'SettingsPage');
const SearchPage = named(() => import('@/pages/SearchPage'), 'SearchPage');
const HistoryPage = named(() => import('@/pages/HistoryPage'), 'HistoryPage');
const TransfersPage = named(() => import('@/pages/TransfersPage'), 'TransfersPage');
const SharesPage = named(() => import('@/pages/SharesPage'), 'SharesPage');
const SharedCollectionPage = named(() => import('@/pages/SharedCollectionPage'), 'SharedCollectionPage');

function AppContent() {
  const { isConfigured, setConfigured } = useSettingsStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    isServerConfigured()
      .then(setConfigured)
      .finally(() => setChecking(false));
    // Protect downloaded tracks from being evicted by the OS
    requestPersistentStorage();
  }, [setConfigured]);

  useEffect(() => {
    if (!isConfigured) return;
    // Bring back the queue and track from the last session (paused)
    audioPlayer.restoreSession();
    playlistSyncService.start();
    playlistSyncService.downloadMissingTracks();
    storageService.autoClean();
    return () => playlistSyncService.stop();
  }, [isConfigured]);

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <LoadingScreen message={t('Loading...')} />
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen bg-slate-900" />}>
      <Routes>
        <Route path="/setup" element={<SetupPage />} />

        {isConfigured ? (
          <>
            <Route element={<AppShell />}>
              <Route path="/channels" element={<ChannelsPage />} />
              <Route path="/channels/:id" element={<ChannelDetailPage />} />
              <Route path="/local" element={<LocalFilesPage />} />
              <Route path="/search" element={<SearchPage />} />
              <Route path="/playlists" element={<PlaylistsPage />} />
              <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
              <Route path="/smart/:id" element={<SmartPlaylistPage />} />
              <Route path="/history" element={<HistoryPage />} />
              <Route path="/downloads" element={<DownloadsPage />} />
              <Route path="/storage" element={<StoragePage />} />
              <Route path="/transfers" element={<TransfersPage />} />
              <Route path="/shares" element={<SharesPage />} />
              <Route path="/shares/:id" element={<SharedCollectionPage />} />
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
            <Route path="*" element={<Navigate to="/channels" replace />} />
          </>
        ) : (
          <Route path="*" element={<Navigate to="/setup" replace />} />
        )}
      </Routes>
    </Suspense>
  );
}

export default function App() {
  // Use basename for GitHub Pages deployment at /TFMPlayer/
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '');

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: queryPersister,
        maxAge: PERSIST_MAX_AGE,
        buster: QUERY_CACHE_BUSTER,
        dehydrateOptions: {
          shouldDehydrateQuery: (query) =>
            query.state.status === 'success' && query.meta?.persist === true
        }
      }}
    >
      <ThemeController />
      <BrowserRouter basename={basename}>
        <AppContent />
      </BrowserRouter>
      <PWAUpdatePrompt />
    </PersistQueryClientProvider>
  );
}
