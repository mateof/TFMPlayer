import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Loader2, MessageSquareText, Play, Search } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { LoadingScreen } from '@/components/common/Spinner';
import { TrackList } from '@/components/tracks/TrackList';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useDebounce } from '@/hooks/useDebounce';
import { useServerFeatures } from '@/hooks/useServerFeatures';
import { useChannelInfoQuery } from '@/hooks/queries';
import { getV1Api } from '@/services/api/v1';
import { messageToTrack } from '@/utils/messageTracks';
import { formatDate, formatDuration } from '@/utils/format';
import { t } from '@/i18n';

const PAGE_SIZE = 50;

/**
 * Audio of the channel's Telegram history, straight from Telegram: also the
 * messages the index doesn't have (never refreshed, or posted since). They
 * play without indexing them (`messages.browse` + `messages.content`).
 */
export function ChannelMessagesPage() {
  const { id = '' } = useParams<{ id: string }>();
  const { features, loaded } = useServerFeatures();
  const supported = features.has('messages.browse') && features.has('messages.content');
  const channelName = useChannelInfoQuery(id).data?.name ?? '';
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim(), 500);
  const { play } = useAudioPlayer();

  const query = useInfiniteQuery({
    queryKey: ['messages', id, 'audio', debounced],
    queryFn: async ({ pageParam, signal }) =>
      (await getV1Api()).messages.search(id, { kind: 'audio', q: debounced || undefined, offsetId: pageParam, limit: PAGE_SIZE }, signal),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last?.nextOffsetId ?? undefined,
    enabled: supported && !!id
  });

  const messages = useMemo(
    () => (query.data?.pages ?? []).flatMap((p) => p?.items ?? []).filter((m) => m.hasMedia),
    [query.data]
  );
  const tracks = useMemo(() => messages.map((m) => messageToTrack(m, id, channelName)), [messages, id, channelName]);
  const total = query.data?.pages[0]?.total ?? 0;

  const playFrom = (index: number) => {
    if (tracks[index]) play(tracks[index], tracks, index);
  };

  return (
    <div className="flex flex-col h-full">
      <Header
        title={t('Chat audio')}
        subtitle={channelName ? `${channelName}${supported && total ? ` · ${t('{count} tracks', { count: total })}` : ''}` : undefined}
        showBack
        backPath={`/channels/${id}`}
      />

      {!loaded ? (
        <LoadingScreen message={t('Loading...')} />
      ) : !supported ? (
        <div className="flex flex-col items-center py-12 px-6 text-center text-slate-400">
          <MessageSquareText className="w-12 h-12 mb-4 opacity-50" aria-hidden />
          <p>{t('This server cannot play the chat history yet')}</p>
          <p className="text-sm mt-2">{t('Update TelegramFileManager to use this section.')}</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-800">
            <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
              <Search className="w-4 h-4 text-slate-400" aria-hidden />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('Search the chat...')}
                aria-label={t('Search the chat audio')}
                className="flex-1 bg-transparent text-white placeholder-slate-400 outline-none text-sm"
              />
            </div>
            {tracks.length > 0 && (
              <button onClick={() => playFrom(0)} className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-emerald-500 text-white text-sm">
                <Play className="w-4 h-4" fill="currentColor" aria-hidden />
                {t('Play all')}
              </button>
            )}
          </div>
          <p className="px-4 pt-2 text-xs text-slate-500">{t('Straight from Telegram, including what the index does not have yet.')}</p>

          {query.isPending ? (
            <LoadingScreen message={t('Loading...')} />
          ) : query.isError ? (
            <p className="px-4 py-12 text-center text-red-400" role="alert">{t('Could not read the chat history')}</p>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col">
              <TrackList
                tracks={tracks}
                label={t('Chat audio')}
                onPlay={playFrom}
                emptyText={debounced ? t('No audio matches "{query}".', { query: debounced }) : t('No audio in this chat')}
                renderMeta={(track, i) => {
                  const m = messages[i];
                  return [track.artist, m?.duration ? formatDuration(m.duration) : null, m ? formatDate(m.date) : null].filter(Boolean).join(' · ');
                }}
              />
              {query.hasNextPage && (
                <div className="shrink-0 flex justify-center py-3 border-t border-slate-800">
                  <button
                    onClick={() => query.fetchNextPage()}
                    disabled={query.isFetchingNextPage}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700 text-slate-200 text-sm disabled:opacity-60"
                  >
                    {query.isFetchingNextPage && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
                    {t('Load more')}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
