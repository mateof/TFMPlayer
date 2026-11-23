import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';

import { AppShell } from '@/components/layout/AppShell';
import { SetupPage } from '@/pages/SetupPage';
import { ChannelsPage } from '@/pages/ChannelsPage';
import { ChannelDetailPage } from '@/pages/ChannelDetailPage';
import { LocalFilesPage } from '@/pages/LocalFilesPage';
import { PlaylistsPage } from '@/pages/PlaylistsPage';
import { PlaylistDetailPage } from '@/pages/PlaylistDetailPage';
import { DownloadsPage } from '@/pages/DownloadsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { SearchPage } from '@/pages/SearchPage';
import { LoadingScreen } from '@/components/common/Spinner';
import { PWAUpdatePrompt } from '@/components/common/PWAUpdatePrompt';

import { isServerConfigured, requestPersistentStorage } from '@/db/database';
import { useSettingsStore } from '@/stores/settingsStore';
import { playlistSyncService } from '@/services/sync/PlaylistSyncService';
import { queryClient, queryPersister, PERSIST_MAX_AGE, QUERY_CACHE_BUSTER } from '@/services/query/queryClient';


function AppContent() {
  const { isConfigured, setConfigured } = useSettingsStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkConfiguration();
    // Protect downloaded tracks from being evicted by the OS
    requestPersistentStorage();
  }, []);

  // Start playlist sync service when configured
  useEffect(() => {
    if (isConfigured) {
      playlistSyncService.start();
      // Also check for missing tracks on startup
      playlistSyncService.downloadMissingTracks();
    }

    return () => {
      playlistSyncService.stop();
    };
  }, [isConfigured]);

  const checkConfiguration = async () => {
    try {
      const configured = await isServerConfigured();
      setConfigured(configured);
    } finally {
      setChecking(false);
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <LoadingScreen message="Loading..." />
      </div>
    );
  }

  return (
    <Routes>
      {/* Setup route - always accessible */}
      <Route path="/setup" element={<SetupPage />} />

      {/* Protected routes */}
      {isConfigured ? (
        <>
          <Route element={<AppShell />}>
            <Route path="/channels" element={<ChannelsPage />} />
            <Route path="/channels/:id" element={<ChannelDetailPage />} />
            <Route path="/local" element={<LocalFilesPage />} />
            <Route path="/playlists" element={<PlaylistsPage />} />
            <Route path="/playlists/:id" element={<PlaylistDetailPage />} />
            <Route path="/downloads" element={<DownloadsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/search" element={<SearchPage />} />
          </Route>
          <Route path="*" element={<Navigate to="/channels" replace />} />
        </>
      ) : (
        <Route path="*" element={<Navigate to="/setup" replace />} />
      )}
    </Routes>
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
      <BrowserRouter basename={basename}>
        <AppContent />
      </BrowserRouter>
      <PWAUpdatePrompt />
    </PersistQueryClientProvider>
  );
}
