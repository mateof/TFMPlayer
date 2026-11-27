import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Shuffle, Trash2, Clock, Flame } from 'lucide-react';
import { Header, HeaderAction } from '@/components/layout/Header';
import { TrackList } from '@/components/tracks/TrackList';
import { LoadingScreen } from '@/components/common/Spinner';
import { confirmDialog } from '@/components/common/confirm';
import { playHistory, type HistoryItem } from '@/services/history/PlayHistoryService';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { formatRelativeTime } from '@/utils/format';
import { t } from '@/i18n';

type Tab = 'recent' | 'top';

/** Recently played and most played tracks (shared with the server when it has player.sync, else this device's). */
export function HistoryPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab: Tab = searchParams.get('tab') === 'top' ? 'top' : 'recent';
  const queryClient = useQueryClient();
  const { play } = useAudioPlayer();

  const query = useQuery({
    queryKey: ['history', tab],
    queryFn: () => (tab === 'top' ? playHistory.mostPlayed(90, 200) : playHistory.recent(200)),
    // Local data: always re-read when the page opens
    staleTime: 0
  });

  const items: HistoryItem[] = useMemo(() => query.data ?? [], [query.data]);
  const tracks = useMemo(() => items.map((i) => i.track), [items]);

  const playFrom = (index: number, shuffle = false) => {
    if (tracks.length === 0) return;
    const list = shuffle ? [...tracks].sort(() => Math.random() - 0.5) : tracks;
    play(list[index], list, index);
  };

  const clear = async () => {
    const ok = await confirmDialog({
      title: t('Clear listening history?'),
      message: t('Recently played and most played lists start from scratch. Downloads are not affected.'),
      confirmLabel: t('Clear'),
      danger: true
    });
    if (!ok) return;
    await playHistory.clear();
    queryClient.invalidateQueries({ queryKey: ['history'] });
  };

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'recent', label: t('Recently played'), icon: <Clock className="w-4 h-4" aria-hidden /> },
    { key: 'top', label: t('Most played'), icon: <Flame className="w-4 h-4" aria-hidden /> }
  ];

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t('History')}
        subtitle={tab === 'top' ? t('Last 90 days') : undefined}
        actions={<HeaderAction icon={<Trash2 className="w-5 h-5" aria-hidden />} onClick={clear} label={t('Clear history')} />}
      />

      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
        <div role="tablist" className="flex gap-2">
          {tabs.map((tb) => (
            <button
              key={tb.key}
              role="tab"
              aria-selected={tab === tb.key}
              onClick={() => setSearchParams(tb.key === 'recent' ? {} : { tab: tb.key }, { replace: true })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors ${
                tab === tb.key ? 'bg-emerald-500 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {tb.icon}
              {tb.label}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {tracks.length > 0 && (
          <>
            <button
              onClick={() => playFrom(0, true)}
              className="p-2 rounded-full bg-slate-800 hover:bg-slate-700 text-white"
              aria-label={t('Shuffle play')}
              title={t('Shuffle play')}
            >
              <Shuffle className="w-4 h-4" aria-hidden />
            </button>
            <button
              onClick={() => playFrom(0)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-emerald-500 text-white text-sm"
            >
              <Play className="w-4 h-4" fill="currentColor" aria-hidden />
              {t('Play all')}
            </button>
          </>
        )}
      </div>

      {query.isPending ? (
        <LoadingScreen message={t('Loading...')} />
      ) : (
        <TrackList
          tracks={tracks}
          label={tabs.find((tb) => tb.key === tab)!.label}
          onPlay={(i) => playFrom(i)}
          emptyText={t('Nothing played yet. Tracks show up here after 30 seconds of listening.')}
          renderMeta={(track, i) => {
            const item = items[i];
            const source = track.artist || track.channelName;
            const plays = t('{count} plays', { count: item.plays });
            return tab === 'top'
              ? `${plays} · ${source}`
              : `${formatRelativeTime(item.playedAt)} · ${source}`;
          }}
        />
      )}
    </div>
  );
}
