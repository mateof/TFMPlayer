import { describe, expect, it } from 'vitest';
import { notificationToast } from './serverEvents';

describe('notificationToast', () => {
  it('joins the title and the message and keeps the level', () => {
    expect(notificationToast({ level: 'success', title: 'Download', message: 'song.mp3 completed' }))
      .toEqual({ message: 'Download: song.mp3 completed', type: 'success' });
  });

  it('does not repeat a title the message already starts with', () => {
    expect(notificationToast({ level: 'info', title: 'Upload', message: 'Upload finished' })?.message).toBe('Upload finished');
  });

  it('stays quiet about the preloads the player asks for', () => {
    expect(notificationToast({ level: 'info', title: 'Preload', message: 'Starting preload of 1 items to cache' })).toBeNull();
    expect(notificationToast({ level: 'error', title: 'Preload Error', message: 'boom' })).toBeNull();
  });

  it('falls back to info for unknown levels', () => {
    expect(notificationToast({ level: 'debug' as never, message: 'x' })?.type).toBe('info');
  });
});
