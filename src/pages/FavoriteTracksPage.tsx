import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Play, Shuffle } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { TrackList } from '@/components/tracks/TrackList';
import { LoadingScreen } from '@/components/common/Spinner';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useServerFeatures } from '@/hooks/useServerFeatures';
import { favoritesService, useFavoritesStore } from '@/services/player/FavoritesService';
import { trackKey } from '@/services/player/playerTrack';
import { useSettingsStore } from '@/stores/settingsStore';
import { t } from '@/i18n';

const FAVORITE_TRACKS_QUERY = ['favorite-tracks'] as const;

/** Tracks marked with the heart (shared with the server when it has player.sync). */
export function FavoriteTracksPage() {
  const { play } = useAudioPlayer();
  const { features } = useServerFeatures();
  const sync = useSettingsStore((s) => s.syncPlayerData) && features.has('player.sync');
  // Re-read when the set of hearts changes (here or on another device)
  const keys = useFavoritesStore((s) => s.keys);
  const query = useQuery({
    queryKey: [...FAVORITE_TRACKS_QUERY, sync, keys.size],
    queryFn: () => favoritesService.list(),
    staleTime: 0
  });
  const tracks = useMemo(
    () => (query.data ?? []).filter((track) => keys.size === 0 || keys.has(trackKey(track))),
    [query.data, keys]
  );

  const playFrom = (index: number, shuffle = false) => {
    if (tracks.length === 0) return;
    const list = shuffle ? [...tracks].sort(() => Math.random() - 0.5) : tracks;
    play(list[index], list, index);
  };

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t('Favourite tracks')}
        subtitle={sync ? t('Shared with the server') : t('On this device')}
        showBack
        backPath="/playlists"
      />
      {tracks.length > 0 && (
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-b border-slate-800">
          <button
            onClick={() => playFrom(0, true)}
            className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-white"
            aria-label={t('Shuffle play')}
            title={t('Shuffle play')}
          >
            <Shuffle className="w-4 h-4" aria-hidden />
          </button>
          <button onClick={() => playFrom(0)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500 text-white text-sm">
            <Play className="w-4 h-4" fill="currentColor" aria-hidden />
            {t('Play all')}
          </button>
        </div>
      )}
      {query.isPending ? (
        <LoadingScreen message={t('Loading...')} />
      ) : query.isError ? (
        <p className="px-4 py-12 text-center text-red-400" role="alert">{t('Could not load the favourite tracks')}</p>
      ) : (
        <TrackList
          tracks={tracks}
          label={t('Favourite tracks')}
          onPlay={(i) => playFrom(i)}
          emptyText={t('Mark tracks with the heart in the player and they show up here.')}
          renderMeta={(track) => track.artist || track.channelName}
        />
      )}
    </div>
  );
}

