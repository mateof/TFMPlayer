import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { AppShell } from '@/components/layout/AppShell';
import { SetupPage } from '@/pages/SetupPage';
import { ChannelsPage } from '@/pages/ChannelsPage';
import { ChannelDetailPage } from '@/pages/ChannelDetailPage';
import { LocalFilesPage } from '@/pages/LocalFilesPage';
import { PlaylistsPage } from '@/pages/PlaylistsPage';
import { PlaylistDetailPage } from '@/pages/PlaylistDetailPage';
import { DownloadsPage } from '@/pages/DownloadsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { LoadingScreen } from '@/components/common/Spinner';

import { isServerConfigured } from '@/db/database';
import { useSettingsStore } from '@/stores/settingsStore';
import { playlistSyncService } from '@/services/sync/PlaylistSyncService';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false
    }
  }
});

function AppContent() {
  const { isConfigured, setConfigured } = useSettingsStore();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    checkConfiguration();
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
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={basename}>
        <AppContent />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
