import { Outlet } from 'react-router-dom';
import { TabBar } from './TabBar';
import { MiniPlayer } from '../player/MiniPlayer';
import { ToastContainer } from '../common/Toast';
import { PlayerOverlay } from '../player/PlayerOverlay';
import { useUiStore } from '@/stores/uiStore';

export function AppShell() {
  const isPlayerExpanded = useUiStore((s) => s.isPlayerExpanded);

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
