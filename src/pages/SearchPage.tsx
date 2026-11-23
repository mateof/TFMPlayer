import { useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Search, X, Music, Play, Plus, ListPlus, Download, HardDrive, Loader2, Info, Check } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { PlaylistPicker } from '@/components/playlists/PlaylistPicker';
import { ChannelAvatar } from '@/components/channels/ChannelAvatar';
import { useDebounce } from '@/hooks/useDebounce';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useCachedTrackIds } from '@/hooks/useCachedTrackIds';
import { useMediaQuery, DESKTOP_QUERY } from '@/hooks/useMediaQuery';
import { searchApi, type SearchScope } from '@/services/api/search.api';
import { downloadManager } from '@/services/download/DownloadManager';
import { queryKeys } from '@/services/query/queryClient';
import { useUiStore } from '@/stores/uiStore';
import { fileToTrack } from '@/utils/channelTracks';
import { localFileToTrack } from '@/utils/collectTracks';
import { setDragPayload } from '@/utils/dragTracks';
import { formatFileSize } from '@/utils/format';
import type { Track } from '@/types/models';

const MIN_QUERY_LENGTH = 2;

const scopes: { key: SearchScope; label: string }[] = [
  { key: 'all', label: 'Everywhere' },
  { key: 'channels', label: 'Channels' },
  { key: 'local', label: 'Local files' }
];

interface ResultGroup {
  key: string;
  title: string;
  channelId?: string;
  tracks: Track[];
}

/** Audio search across every channel index and the server's local files. */
export function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const addToast = useUiStore((s) => s.addToast);
  const { play, playNext } = useAudioPlayer();
  const isDesktop = useMediaQuery(DESKTOP_QUERY);
  const [pickerTracks, setPickerTracks] = useState<Track[] | null>(null);

  const q = searchParams.get('q') ?? '';
  const rawScope = searchParams.get('scope');
  const scope: SearchScope = rawScope === 'channels' || rawScope === 'local' ? rawScope : 'all';
  const debouncedQ = useDebounce(q.trim(), 500);

  const setParam = (key: string, value: string | null) =>
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value) params.set(key, value);
      else params.delete(key);
      return params;
    }, { replace: true });

  const enabled = debouncedQ.length >= MIN_QUERY_LENGTH;
  const query = useQuery({
    queryKey: queryKeys.search(debouncedQ, scope),
    queryFn: ({ signal }) => searchApi.search(debouncedQ, scope, signal),
    enabled,
    staleTime: 5 * 60 * 1000,
    retry: false
  });

  const groups = useMemo<ResultGroup[]>(() => {
    const data = query.data;
    if (!data) return [];
    const result: ResultGroup[] = data.channels.map((g) => ({
      key: `channel:${g.channelId}`,
      title: g.channelName,
      channelId: g.channelId,
      tracks: g.files.map((f) => fileToTrack(f, g.channelId, g.channelName))
    }));
    if (data.local.length > 0) {
      result.push({ key: 'local', title: 'Local files', tracks: data.local.map(localFileToTrack) });
    }
    return result;
  }, [query.data]);

  const allTracks = useMemo(() => groups.flatMap((g) => g.tracks), [groups]);
  const cached = useCachedTrackIds(useMemo(() => allTracks.map((t) => t.fileId), [allTracks]));

  const playFrom = (tracks: Track[], index: number) => play(tracks[index], tracks, index);

  const rowAction = (label: string, icon: React.ReactNode, onClick: () => void) => (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="p-2 text-slate-500 hover:text-emerald-400 transition-colors"
      aria-label={label}
      title={label}
    >
      {icon}
    </button>
  );

  return (
    <div className="flex flex-col min-h-screen lg:min-h-0">
      <Header title="Search" subtitle="Audio in every channel and in local files" />

      <div className="sticky top-14 z-20 bg-slate-900 border-b border-slate-700 px-4 py-3 space-y-3">
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800 focus-within:ring-2 focus-within:ring-emerald-400">
          <Search className="w-5 h-5 text-slate-400" aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(e) => setParam('q', e.target.value || null)}
            placeholder="Song, artist, album, file name..."
            aria-label="Search audio"
            className="flex-1 bg-transparent text-white placeholder-slate-400 outline-none"
            autoFocus
          />
          {query.isFetching && <Loader2 className="w-4 h-4 animate-spin text-emerald-400" aria-label="Searching" />}
          {q && (
            <button onClick={() => setParam('q', null)} className="p-1 text-slate-400 hover:text-white" aria-label="Clear search">
              <X className="w-4 h-4" aria-hidden />
            </button>
          )}
        </div>
        <div className="flex gap-2" role="radiogroup" aria-label="Where to search">
          {scopes.map((s) => (
            <button
              key={s.key}
              role="radio"
              aria-checked={scope === s.key}
              onClick={() => setParam('scope', s.key === 'all' ? null : s.key)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                scope === s.key ? 'bg-emerald-500 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              {s.label}
            </button>
          ))}
          {allTracks.length > 0 && (
            <button
              onClick={() => playFrom(allTracks, 0)}
              className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500 text-white text-sm"
            >
              <Play className="w-3.5 h-3.5" fill="currentColor" aria-hidden />
              Play all
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 pb-6" aria-live="polite">
        {!enabled ? (
          <p className="px-4 py-12 text-center text-slate-400">
            Type at least {MIN_QUERY_LENGTH} characters to search.
          </p>
        ) : query.isPending ? (
          <p className="px-4 py-12 text-center text-slate-400">Searching...</p>
        ) : query.isError ? (
          <p className="px-4 py-12 text-center text-red-400">The search failed. Check the connection to the server.</p>
        ) : (
          <>
            {query.data?.mode === 'favorites' && scope !== 'local' && (
              <div className="mx-4 mt-3 flex gap-2 p-3 rounded-lg bg-slate-800 text-xs text-slate-300">
                <Info className="w-4 h-4 shrink-0 text-sky-400" aria-hidden />
                This server does not support global search yet, so only your favourite channels were searched.
                Update TelegramFileManager to search every channel and the local files.
              </div>
            )}
            {query.data?.mode === 'favorites' && scope === 'local' && (
              <p className="px-4 py-12 text-center text-slate-400">
                Searching local files needs a newer TelegramFileManager.
              </p>
            )}
            {query.data?.truncated && (
              <p className="mx-4 mt-3 text-xs text-amber-300">
                Too many matches: showing the first ones. Refine the search to see the rest.
              </p>
            )}
            {groups.length === 0 && !(query.data?.mode === 'favorites' && scope === 'local') && (
              <p className="px-4 py-12 text-center text-slate-400">No audio matches "{debouncedQ}".</p>
            )}

            {groups.map((group) => (
              <section key={group.key} className="mt-4" aria-label={`${group.title}: ${group.tracks.length} results`}>
                <div className="flex items-center gap-3 px-4 py-2">
                  {group.channelId ? (
                    <ChannelAvatar channelId={group.channelId} name={group.title} size="sm" />
                  ) : (
                    <HardDrive className="w-5 h-5 text-slate-400" aria-hidden />
                  )}
                  {group.channelId ? (
                    <Link to={`/channels/${group.channelId}`} className="flex-1 font-medium text-white hover:underline truncate">
                      {group.title}
                    </Link>
                  ) : (
                    <span className="flex-1 font-medium text-white">{group.title}</span>
                  )}
                  <span className="text-xs text-slate-500">{group.tracks.length}</span>
                  <button
                    onClick={() => playFrom(group.tracks, 0)}
                    className="p-1.5 rounded-full bg-slate-700 hover:bg-slate-600 text-white"
                    aria-label={`Play the ${group.tracks.length} results from ${group.title}`}
                  >
                    <Play className="w-3.5 h-3.5" fill="currentColor" aria-hidden />
                  </button>
                </div>
                <ul className="divide-y divide-slate-800">
                  {group.tracks.map((track, index) => (
                    <li key={track.fileId}>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => playFrom(group.tracks, index)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.stopPropagation();
                            playFrom(group.tracks, index);
                          }
                        }}
                        draggable={isDesktop}
                        onDragStart={(e) => setDragPayload(e, [{ kind: 'track', track }])}
                        className="group flex items-center gap-3 px-4 py-2.5 hover:bg-slate-800 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-400"
                        aria-label={`Play ${track.title || track.fileName}${cached.has(track.fileId) ? ', on device' : ''}`}
                      >
                        <div className="relative w-9 h-9 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0" aria-hidden>
                          <Music className="w-4 h-4" />
                          {cached.has(track.fileId) && (
                            <div className="absolute -bottom-1 -right-1 w-4 h-4 bg-emerald-500 rounded-full flex items-center justify-center">
                              <Check className="w-2.5 h-2.5 text-white" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white truncate" title={track.fileName}>{track.title || track.fileName}</p>
                          <p className="text-xs text-slate-500 truncate">
                            {track.filePath || track.fileName} · {formatFileSize(track.fileSize)}
                          </p>
                        </div>
                        {rowAction('Play next', <ListPlus className="w-5 h-5" aria-hidden />, () => {
                          playNext(track);
                          addToast('Will play next', 'success');
                        })}
                        {!cached.has(track.fileId) && rowAction('Download', <Download className="w-5 h-5" aria-hidden />, async () => {
                          await downloadManager.addToQueue(track);
                          addToast('Added to download queue', 'info');
                        })}
                        {rowAction('Add to playlist', <Plus className="w-5 h-5" aria-hidden />, () => setPickerTracks([track]))}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </>
        )}
      </div>

      {pickerTracks && <PlaylistPicker tracks={pickerTracks} onClose={() => setPickerTracks(null)} />}
    </div>
  );
}
