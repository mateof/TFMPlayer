import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ChevronRight, FolderOpen, Loader2, Search, Share2 } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { LoadingScreen } from '@/components/common/Spinner';
import { useDebounce } from '@/hooks/useDebounce';
import { useServerFeatures } from '@/hooks/useServerFeatures';
import { getV1Api } from '@/services/api/v1';
import { formatDate } from '@/utils/format';
import { t } from '@/i18n';

const PAGE_SIZE = 50;

/** Shared collections imported on the server (read-only browsing). */
export function SharesPage() {
  const { features, loaded } = useServerFeatures();
  const supported = features.has('shares.browse');
  const [filter, setFilter] = useState('');
  const debounced = useDebounce(filter, 400);

  const query = useInfiniteQuery({
    queryKey: ['shares', debounced],
    queryFn: async ({ pageParam, signal }) =>
      (await getV1Api()).shares.list({ page: pageParam, pageSize: PAGE_SIZE, filter: debounced || undefined }, signal),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.page.hasNext ? last.page.page + 1 : undefined),
    enabled: supported
  });

  const collections = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = query.data?.pages[0]?.page.totalItems ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* Reached from the channels screen (no tab of its own on mobile): needs a way back */}
      <Header
        title={t('Shared collections')}
        subtitle={supported ? t('{count} collections', { count: total }) : undefined}
        showBack
        backPath="/channels"
      />

      {!loaded ? (
        <LoadingScreen message={t('Loading...')} />
      ) : !supported ? (
        <Unsupported />
      ) : (
        <div className="flex-1 overflow-y-auto">
          <div className="flex items-center gap-2 mx-4 my-3 px-3 py-2 rounded-lg bg-slate-800 border border-slate-700">
            <Search className="w-4 h-4 text-slate-400" aria-hidden />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('Filter by name...')}
              aria-label={t('Filter collections by name')}
              className="flex-1 bg-transparent text-white placeholder-slate-400 outline-none text-sm"
            />
          </div>

          {query.isPending ? (
            <LoadingScreen message={t('Loading collections...')} />
          ) : query.isError ? (
            <p className="px-4 py-10 text-center text-sm text-red-400" role="alert">{t('Could not load the shared collections')}</p>
          ) : collections.length === 0 ? (
            <div className="flex flex-col items-center py-12 px-6 text-center text-slate-400">
              <Share2 className="w-12 h-12 mb-4 opacity-50" aria-hidden />
              <p>{t('No shared collections yet')}</p>
              <p className="text-sm mt-2">{t('Import a share in TelegramFileManager and it appears here.')}</p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-700 border-y border-slate-700" aria-label={t('Shared collections')}>
              {collections.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/shares/${encodeURIComponent(c.id)}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-800 focus-visible:bg-slate-800 outline-none"
                  >
                    <div className="w-10 h-10 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center shrink-0">
                      <FolderOpen className="w-5 h-5" aria-hidden />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate">{c.name || t('Untitled collection')}</p>
                      <p className="text-xs text-slate-400 truncate">
                        {c.description || t('Added {date}', { date: formatDate(c.dateCreated) })}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 text-slate-500" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {query.hasNextPage && (
            <div className="flex justify-center py-4">
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
    </div>
  );
}

function Unsupported() {
  return (
    <div className="flex flex-col items-center py-12 px-6 text-center text-slate-400">
      <Share2 className="w-12 h-12 mb-4 opacity-50" aria-hidden />
      <p>{t('This server cannot browse shared collections')}</p>
      <p className="text-sm mt-2">{t('Update TelegramFileManager to use this section.')}</p>
    </div>
  );
}
