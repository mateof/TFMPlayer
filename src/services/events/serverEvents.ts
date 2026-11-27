import { eventsHub } from './hub';
import { serverCapabilities } from '@/services/server/capabilities';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';
import { queryClient } from '@/services/query/queryClient';
import { favoritesService } from '@/services/player/FavoritesService';
import { resumeService } from '@/services/player/ResumeService';
import type { PlayerDataChangedEvent } from '@/services/api/v1';

/** Payload of the hub's `Notification` message. */
export interface NotificationEvent {
  level: 'info' | 'success' | 'warning' | 'error';
  title?: string | null;
  message: string;
  at?: string;
}

/**
 * The player asks the server to preload every next track: the server's
 * "Preload" notifications would pop up on every song, so they stay quiet.
 */
function isPlayerNoise(event: NotificationEvent): boolean {
  return /^preload/i.test(event.title ?? '');
}

export function notificationToast(event: NotificationEvent): { message: string; type: 'success' | 'error' | 'info' | 'warning' } | null {
  if (!event?.message || isPlayerNoise(event)) return null;
  const type = event.level === 'success' || event.level === 'warning' || event.level === 'error' ? event.level : 'info';
  const title = event.title?.trim();
  return { message: title && !event.message.startsWith(title) ? `${title}: ${event.message}` : event.message, type };
}

/**
 * Connects the events hub while the app is configured and the server has it
 * (`events.hub`), and shows the server's notifications as toasts (Settings
 * can turn them off). Shared player data is reloaded when another device
 * changes it; other services subscribe to their own messages.
 */
export function startServerEvents(): () => void {
  let cancelled = false;
  let release: (() => void) | null = null;

  const offNotification = eventsHub.on('Notification', (event: NotificationEvent) => {
    if (!useSettingsStore.getState().serverNotifications) return;
    const toast = notificationToast(event);
    if (toast) useUiStore.getState().addToast(toast.message, toast.type);
  });

  // Another device (or the web app) changed the shared player data
  const offPlayerData = eventsHub.on('PlayerDataChanged', (event: PlayerDataChangedEvent) => {
    if (event?.kind === 'favorites') {
      void favoritesService.load(true);
      void queryClient.invalidateQueries({ queryKey: ['favorite-tracks'] });
    } else if (event?.kind === 'history') {
      void queryClient.invalidateQueries({ queryKey: ['history'] });
    } else if (event?.kind === 'resume') {
      void resumeService.syncFromServer();
    }
  });

  serverCapabilities.get().then((caps) => {
    if (!cancelled && caps.features.has('events.hub')) release = eventsHub.acquire();
  }).catch(() => {});

  return () => {
    cancelled = true;
    release?.();
    offNotification();
    offPlayerData();
  };
}
