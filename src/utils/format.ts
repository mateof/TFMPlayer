import { getLanguage, t } from '@/i18n';

/**
 * Format duration in seconds to mm:ss or h:mm:ss
 */
export function formatDuration(seconds: number): string {
  if (!seconds || isNaN(seconds)) return '0:00';

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format file size in bytes to human readable format
 */
export function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);

  return `${size.toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/**
 * Format date to localized string
 */
export function formatDate(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString(getLanguage() === 'es' ? 'es-ES' : 'en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/**
 * Format date to relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 7) {
    return formatDate(d);
  } else if (diffDays > 0) {
    return diffDays > 1 ? t('{count} days ago', { count: diffDays }) : t('1 day ago');
  } else if (diffHours > 0) {
    return diffHours > 1 ? t('{count} hours ago', { count: diffHours }) : t('1 hour ago');
  } else if (diffMins > 0) {
    return diffMins > 1 ? t('{count} minutes ago', { count: diffMins }) : t('1 minute ago');
  } else {
    return t('Just now');
  }
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Calculate bitrate from file size and duration
 */
export function calculateBitrate(fileSize: number, durationSeconds: number): string {
  if (!fileSize || !durationSeconds) return t('Unknown');
  const bitrate = (fileSize * 8) / durationSeconds / 1000;
  return `${Math.round(bitrate)} kbps`;
}
