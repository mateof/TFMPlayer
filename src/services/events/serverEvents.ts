import { eventsHub } from './hub';
import { serverCapabilities } from '@/services/server/capabilities';
import { useSettingsStore } from '@/stores/settingsStore';
import { useUiStore } from '@/stores/uiStore';

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
 * can turn them off). Services subscribe to the other messages themselves.
 */
export function startServerEvents(): () => void {
  let cancelled = false;
  let release: (() => void) | null = null;

  const offNotification = eventsHub.on('Notification', (event: NotificationEvent) => {
    if (!useSettingsStore.getState().serverNotifications) return;
    const toast = notificationToast(event);
    if (toast) useUiStore.getState().addToast(toast.message, toast.type);
  });

  serverCapabilities.get().then((caps) => {
    if (!cancelled && caps.features.has('events.hub')) release = eventsHub.acquire();
  }).catch(() => {});

  return () => {
    cancelled = true;
    release?.();
    offNotification();
  };
}
