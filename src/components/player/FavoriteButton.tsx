import { Heart } from 'lucide-react';
import { favoritesService, useIsFavorite } from '@/services/player/FavoritesService';
import { useUiStore } from '@/stores/uiStore';
import type { Track } from '@/types/models';
import { t } from '@/i18n';

/** Heart that marks a track as favourite (shared with the server when it can). */
export function FavoriteButton({ track, size = 'md', className = '' }: { track: Track | null | undefined; size?: 'md' | 'lg'; className?: string }) {
  const isFavorite = useIsFavorite(track);
  if (!track) return null;
  const label = isFavorite ? t('Remove from favourite tracks') : t('Add to favourite tracks');
  const icon = size === 'lg' ? 'w-6 h-6' : 'w-5 h-5';
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        favoritesService.toggle(track).catch(() => useUiStore.getState().addToast(t('Failed to update favorite'), 'error'));
      }}
      aria-pressed={isFavorite}
      aria-label={label}
      title={label}
      className={`p-2 rounded-full transition-colors ${isFavorite ? 'text-rose-400' : 'text-slate-400 hover:text-white'} ${className}`}
    >
      <Heart className={icon} fill={isFavorite ? 'currentColor' : 'none'} aria-hidden />
    </button>
  );
}
