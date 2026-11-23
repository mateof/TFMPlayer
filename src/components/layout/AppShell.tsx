import { Outlet } from 'react-router-dom';
import { TabBar } from './TabBar';
import { Sidebar } from './Sidebar';
import { MiniPlayer } from '../player/MiniPlayer';
import { DesktopPlayerBar } from '../player/DesktopPlayerBar';
import { NowPlayingPanel } from '../player/NowPlayingPanel';
import { ToastContainer } from '../common/Toast';
import { PlayerOverlay } from '../player/PlayerOverlay';
import { useUiStore } from '@/stores/uiStore';
import { useMediaQuery, DESKTOP_QUERY, WIDE_QUERY } from '@/hooks/useMediaQuery';
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts';

/**
 * Mobile: single column, bottom mini player + tab bar.
 * Desktop (lg+): sidebar | content | now-playing panel (xl+), with a
 * full-width player bar underneath. Each column scrolls on its own.
 */
export function AppShell() {
  const isPlayerExpanded = useUiStore((s) => s.isPlayerExpanded);
  const isPanelOpen = useUiStore((s) => s.isNowPlayingPanelOpen);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const isWide = useMediaQuery(WIDE_QUERY);
  useKeyboardShortcuts();

  if (!isDesktop) {
    return (
      <div className="flex flex-col min-h-screen bg-slate-900">
        <main className="flex-1 pb-32 overflow-y-auto">
          <Outlet />
        </main>
        <MiniPlayer />
        <TabBar />
        <ToastContainer />
        {isPlayerExpanded && <PlayerOverlay />}
      </div>
    );
  }

  return (
    <div className="h-dvh flex flex-col bg-slate-900 overflow-hidden">
      <div className="flex-1 min-h-0 flex">
        <div className="w-60 shrink-0">
          <Sidebar />
        </div>
        <main className="flex-1 min-w-0 overflow-y-auto">
          <Outlet />
        </main>
        {isWide && isPanelOpen && <NowPlayingPanel />}
      </div>
      <DesktopPlayerBar />
      <ToastContainer />
      {isPlayerExpanded && <PlayerOverlay />}
    </div>
  );
}
