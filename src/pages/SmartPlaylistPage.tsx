import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Play, Shuffle, Pencil, Trash2, RefreshCw, Sparkles, ListPlus, Download, Loader2 } from 'lucide-react';
import { Header, HeaderAction } from '@/components/layout/Header';
import { TrackList } from '@/components/tracks/TrackList';
import { SmartPlaylistEditor } from '@/components/playlists/SmartPlaylistEditor';
import { PlaylistPicker } from '@/components/playlists/PlaylistPicker';
import { confirmDialog } from '@/components/common/confirm';
import { smartPlaylists, type SmartRules } from '@/services/playlists/smartPlaylists';
import { downloadManager } from '@/services/download/DownloadManager';
import { useAudioPlayer } from '@/hooks/useAudioPlayer';
import { useUiStore } from '@/stores/uiStore';
import { formatDuration, formatFileSize } from '@/utils/format';
import { t } from '@/i18n';

function describeRules(rules: SmartRules): string {
  const parts: string[] = [];
  parts.push(rules.sources.map((s) => (s.kind === 'local' ? t('Local files') : s.channelName)).join(', '));
  if (rules.formats.length) parts.push(rules.formats.map((f) => f.toUpperCase()).join('/'));
  if (rules.nameContains) parts.push(`“${rules.nameContains}”`);
  if (rules.addedWithinDays) parts.push(t('last {count} days', { count: rules.addedWithinDays }));
  return parts.join(' · ');
}

/** Tracks matching a smart playlist's rules, evaluated on the device. */
export function SmartPlaylistPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const addToast = useUiStore((s) => s.addToast);
  const { play } = useAudioPlayer();
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [progress, setProgress] = useState('');

  const playlistQuery = useQuery({
    queryKey: ['smart', id],
    queryFn: async () => (await smartPlaylists.get(id!)) ?? null,
    enabled: !!id
  });
  const playlist = playlistQuery.data;

  // Persisted: walking whole channels is slow, so the last result shows at
  // once (and offline) while a fresh evaluation runs
  const tracksQuery = useQuery({
    queryKey: ['smart', id, 'tracks', playlist?.updatedAt?.toString()],
    queryFn: () => smartPlaylists.evaluate(playlist!.rules, (label) => setProgress(label)),
    enabled: !!playlist,
    staleTime: 10 * 60 * 1000,
    meta: { persist: true }
  });
  const tracks = tracksQuery.data ?? [];

  const totalSize = tracks.reduce((sum, tr) => sum + (tr.fileSize || 0), 0);
  const totalDuration = tracks.reduce((sum, tr) => sum + (tr.duration || 0), 0);

  const playFrom = (index: number, shuffle = false) => {
    if (tracks.length === 0) return;
    const list = shuffle ? [...tracks].sort(() => Math.random() - 0.5) : tracks;
    play(list[index], list, index);
  };

  const remove = async () => {
    if (!playlist) return;
    const ok = await confirmDialog({
      title: t('Delete smart playlist?'),
      message: t('"{name}" will be deleted. Its tracks are not affected.', { name: playlist.name }),
      confirmLabel: t('Delete'),
      danger: true
    });
    if (!ok) return;
    await smartPlaylists.remove(playlist.id);
    queryClient.invalidateQueries({ queryKey: ['smart'] });
    navigate('/playlists');
  };

  const downloadAll = async () => {
    await downloadManager.addMultipleToQueue(tracks);
    addToast(t('{count} track(s) queued for download', { count: tracks.length }), 'success');
  };

  if (playlistQuery.isSuccess && !playlist) {
    return (
      <div className="flex flex-col h-full">
        <Header title={t('Smart playlist')} showBack backPath="/playlists" />
        <p className="p-8 text-center text-slate-400">{t('This smart playlist no longer exists.')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header
        title={playlist?.name ?? t('Smart playlist')}
        showBack
        backPath="/playlists"
        actions={
          <>
            <HeaderAction
              icon={<RefreshCw className={`w-5 h-5 ${tracksQuery.isFetching ? 'animate-spin' : ''}`} aria-hidden />}
              onClick={() => tracksQuery.refetch()}
              label={t('Refresh')}
              disabled={tracksQuery.isFetching}
            />
            <HeaderAction icon={<Pencil className="w-5 h-5" aria-hidden />} onClick={() => setEditing(true)} label={t('Edit rules')} />
            <HeaderAction icon={<Trash2 className="w-5 h-5" aria-hidden />} onClick={remove} label={t('Delete')} />
          </>
        }
      />

      <div className="px-4 py-4 bg-gradient-to-b from-amber-500/10 to-transparent border-b border-slate-800">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 lg:w-20 lg:h-20 rounded-xl bg-gradient-to-br from-amber-400 to-pink-500 flex items-center justify-center shrink-0 shadow-lg">
            <Sparkles className="w-8 h-8 text-white" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-400 break-words">{playlist ? describeRules(playlist.rules) : ''}</p>
            <p className="mt-1 text-sm text-slate-300">
              {t('{count} tracks', { count: tracks.length })}
              {totalDuration > 0 && ` · ${formatDuration(totalDuration)}`}
              {totalSize > 0 && ` · ${formatFileSize(totalSize)}`}
            </p>
            {tracksQuery.isFetching && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-amber-300" role="status">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />
                {t('Scanning {name}...', { name: progress || '...' })}
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() => playFrom(0)}
            disabled={tracks.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-emerald-500 text-white text-sm font-medium disabled:opacity-50"
          >
            <Play className="w-4 h-4" fill="currentColor" aria-hidden />
            {t('Play all')}
          </button>
          <button
            onClick={() => playFrom(0, true)}
            disabled={tracks.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-700 text-white text-sm disabled:opacity-50"
          >
            <Shuffle className="w-4 h-4" aria-hidden />
            {t('Shuffle')}
          </button>
          <button
            onClick={() => setPickerOpen(true)}
            disabled={tracks.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-700 text-white text-sm disabled:opacity-50"
          >
            <ListPlus className="w-4 h-4" aria-hidden />
            {t('Save as playlist')}
          </button>
          <button
            onClick={downloadAll}
            disabled={tracks.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-700 text-white text-sm disabled:opacity-50"
          >
            <Download className="w-4 h-4" aria-hidden />
            {t('Download all')}
          </button>
        </div>
      </div>

      {tracksQuery.isPending && !tracksQuery.data ? (
        <p className="p-8 text-center text-slate-400" role="status">{t('Scanning {name}...', { name: progress || '...' })}</p>
      ) : (
        <TrackList
          tracks={tracks}
          label={playlist?.name ?? ''}
          onPlay={(i) => playFrom(i)}
          emptyText={t('No tracks match these rules.')}
        />
      )}

      {editing && playlist && (
        <SmartPlaylistEditor
          initial={{ name: playlist.name, rules: playlist.rules }}
          onClose={() => setEditing(false)}
          onSave={async (name, rules) => {
            await smartPlaylists.save({ id: playlist.id, name, rules });
            queryClient.invalidateQueries({ queryKey: ['smart'] });
          }}
        />
      )}
      {pickerOpen && <PlaylistPicker tracks={tracks} onClose={() => setPickerOpen(false)} />}
    </div>
  );
}
