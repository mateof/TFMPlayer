import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Star, Radio, FolderOpen, ChevronRight, HardDrive, X, Share2, ServerCog } from 'lucide-react';
import { Header } from '@/components/layout/Header';
import { ChannelAvatar } from '@/components/channels/ChannelAvatar';
import { Input } from '@/components/common/Input';
import { LoadingScreen } from '@/components/common/Spinner';
import { useUiStore } from '@/stores/uiStore';
import { useServerFeatures } from '@/hooks/useServerFeatures';
import { useChannelsQuery, useFavoriteChannelsQuery, useChannelFoldersQuery, useToggleFavoriteMutation } from '@/hooks/queries';
import type { Channel, ChannelFolder } from '@/types/models';
import { t } from '@/i18n';

type Tab = 'all' | 'favorites' | 'folders' | 'local';

const validTabs: Tab[] = ['all', 'favorites', 'folders', 'local'];

export function ChannelsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { addToast } = useUiStore();

  // Get tab from URL or default to 'all'
  const urlTab = searchParams.get('tab') as Tab | null;
  const initialTab = urlTab && validTabs.includes(urlTab) ? urlTab : 'all';

  const [activeTab, setActiveTabState] = useState<Tab>(initialTab);

  const setActiveTab = useCallback((tab: Tab) => {
    setActiveTabState(tab);
    const params = new URLSearchParams(searchParams);
    if (tab === 'all') {
      params.delete('tab');
    } else {
      params.set('tab', tab);
    }
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);
  const [searchQuery, setSearchQuery] = useState('');

  // Cached (persisted) lists render immediately; the server refresh happens
  // in background and offline visits simply keep the last copy
  const channelsQuery = useChannelsQuery();
  const favoritesQuery = useFavoriteChannelsQuery();
  const foldersQuery = useChannelFoldersQuery();
  const toggleFavoriteMutation = useToggleFavoriteMutation();

  const channels = channelsQuery.data ?? [];
  const favorites = favoritesQuery.data ?? [];
  const folders = foldersQuery.data?.folders ?? [];
  const ungroupedChannels = foldersQuery.data?.ungroupedChannels ?? [];
  const loading = channelsQuery.isPending;

  // Only complain when there is nothing to show at all
  useEffect(() => {
    if (channelsQuery.isError && !channelsQuery.data) {
      addToast(t('Failed to load channels'), 'error');
    }
  }, [channelsQuery.isError, channelsQuery.data, addToast]);

  // Scroll state for compact header
  const [isScrolled, setIsScrolled] = useState(false);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Scroll detection
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      setIsScrolled(container.scrollTop > 20);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [loading]);

  // Focus search input when expanded
  useEffect(() => {
    if (searchExpanded && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [searchExpanded]);

  const toggleFavorite = (channel: Channel, e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavoriteMutation.mutate(channel, {
      onError: () => addToast(t('Failed to update favorite'), 'error')
    });
  };

  const filteredChannels = channels.filter((ch) =>
    ch.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredFavorites = favorites.filter((ch) =>
    ch.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const tabs: { key: Tab; label: string }[] = [
    { key: 'all', label: t('All') },
    { key: 'favorites', label: t('Favorites') },
    { key: 'folders', label: t('Folders') },
    { key: 'local', label: t('Local') }
  ];

  // Search button for header when scrolled
  const searchAction = isScrolled && !searchExpanded ? (
    <button
      onClick={() => setSearchExpanded(true)}
      className={`p-2 rounded-lg transition-colors ${
        searchQuery ? 'bg-emerald-500 text-white' : 'text-slate-400 hover:text-white'
      }`}
    >
      <Search className="w-5 h-5" />
    </button>
  ) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <Header title={t('Channels')} actions={searchAction} />

      {/* Sticky header with search and tabs */}
      <div className="sticky top-0 z-10 bg-slate-900">
        {/* Search - full when not scrolled or when expanded */}
        {(!isScrolled || searchExpanded) && (
          <div className="px-4 py-3 flex items-center gap-2">
            <div className="flex-1">
              <Input
                ref={searchInputRef}
                placeholder={t('Search channels...')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                icon={<Search className="w-4 h-4" />}
              />
            </div>
            {searchExpanded && (
              <button
                onClick={() => {
                  setSearchExpanded(false);
                  if (isScrolled) setSearchQuery('');
                }}
                className="p-2 text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        )}

        {/* Active search indicator when scrolled and search collapsed */}
        {isScrolled && !searchExpanded && searchQuery && (
          <div className="px-4 py-1 text-sm text-emerald-400">
            {t('Searching: "{query}"', { query: searchQuery })}
          </div>
        )}

        {/* Tabs - always visible */}
        <div className="flex border-b border-slate-700">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 lg:flex-none lg:px-6 py-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-emerald-400 border-b-2 border-emerald-400'
                  : 'text-slate-400'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <LoadingScreen message={t('Loading channels...')} />
        ) : activeTab === 'all' ? (
          <ChannelList
            channels={filteredChannels}
            onToggleFavorite={toggleFavorite}
            onSelect={(ch) => navigate(`/channels/${ch.id}`)}
          />
        ) : activeTab === 'favorites' ? (
          <ChannelList
            channels={filteredFavorites}
            onToggleFavorite={toggleFavorite}
            onSelect={(ch) => navigate(`/channels/${ch.id}`)}
            emptyMessage={t('No favorite channels yet')}
          />
        ) : activeTab === 'folders' ? (
          <FoldersList
            folders={folders}
            ungroupedChannels={ungroupedChannels}
            onSelectChannel={(ch) => navigate(`/channels/${ch.id}`)}
          />
        ) : (
          <LocalFilesEntry onNavigate={navigate} />
        )}
      </div>
    </div>
  );
}

interface ChannelListProps {
  channels: Channel[];
  onToggleFavorite: (channel: Channel, e: React.MouseEvent) => void;
  onSelect: (channel: Channel) => void;
  emptyMessage?: string;
}

function ChannelList({ channels, onToggleFavorite, onSelect, emptyMessage }: ChannelListProps) {
  if (channels.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <Radio className="w-12 h-12 mb-4 opacity-50" />
        <p>{emptyMessage || t('No channels found')}</p>
      </div>
    );
  }

  return (
    // One column on mobile, a grid of cards on desktop
    <div className="divide-y divide-slate-700 lg:divide-y-0 lg:grid lg:grid-cols-2 2xl:grid-cols-3 lg:gap-3 lg:p-4">
      {channels.map((channel) => (
        // div, not button: the favourite toggle inside is a button itself
        <div
          key={channel.id}
          role="button"
          tabIndex={0}
          onClick={() => onSelect(channel)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onSelect(channel);
          }}
          className="w-full flex items-center gap-4 p-4 hover:bg-slate-800 transition-colors touch-manipulation text-left cursor-pointer lg:rounded-xl lg:bg-slate-800/50 lg:border lg:border-slate-700/60"
        >
          <ChannelAvatar channelId={channel.id} name={channel.name} />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-white truncate" title={channel.name}>{channel.name}</p>
            <p className="text-sm text-slate-400">
              {t('{count} files', { count: channel.fileCount })}
              <span className="hidden lg:inline">
                {' · '}<span className="capitalize">{channel.type}</span>
                {channel.isOwner && ` · ${t('owner')}`}
              </span>
            </p>
          </div>
          <button
            onClick={(e) => onToggleFavorite(channel, e)}
            className="p-2 touch-manipulation"
            aria-label={channel.isFavorite ? t('Remove from favorites') : t('Add to favorites')}
          >
            <Star
              className={`w-5 h-5 ${
                channel.isFavorite
                  ? 'text-yellow-400 fill-yellow-400'
                  : 'text-slate-500'
              }`}
            />
          </button>
          <ChevronRight className="w-5 h-5 text-slate-500" />
        </div>
      ))}
    </div>
  );
}

interface FoldersListProps {
  folders: ChannelFolder[];
  ungroupedChannels: Channel[];
  onSelectChannel: (channel: Channel) => void;
}

interface LocalFilesEntryProps {
  onNavigate: (to: string) => void;
}

function LocalFilesEntry({ onNavigate }: LocalFilesEntryProps) {
  const { features } = useServerFeatures();
  const entries = [
    { to: '/local', icon: <HardDrive className="w-7 h-7 text-emerald-400" aria-hidden />, tint: 'bg-emerald-500/20', title: t('Local Files'), text: t("Browse files from server's local storage") },
    ...(features.has('shares.browse')
      ? [{ to: '/shares', icon: <Share2 className="w-7 h-7 text-sky-400" aria-hidden />, tint: 'bg-sky-500/20', title: t('Shared collections'), text: t('Files other people shared with this server (read only)') }]
      : []),
    { to: '/transfers', icon: <ServerCog className="w-7 h-7 text-amber-400" aria-hidden />, tint: 'bg-amber-500/20', title: t('Server transfers'), text: t('Downloads and uploads running on the server') }
  ];
  return (
    <div className="p-4 space-y-3">
      {entries.map((entry) => (
        <button
          key={entry.to}
          onClick={() => onNavigate(entry.to)}
          className="w-full flex items-center gap-4 p-6 bg-slate-800 rounded-xl hover:bg-slate-700 transition-colors"
        >
          <div className={`w-14 h-14 ${entry.tint} rounded-xl flex items-center justify-center`}>
            {entry.icon}
          </div>
          <div className="flex-1 text-left">
            <p className="font-medium text-white text-lg">{entry.title}</p>
            <p className="text-sm text-slate-400">{entry.text}</p>
          </div>
          <ChevronRight className="w-6 h-6 text-slate-500" aria-hidden />
        </button>
      ))}
    </div>
  );
}

function FoldersList({ folders, ungroupedChannels, onSelectChannel }: FoldersListProps) {
  const [expandedFolders, setExpandedFolders] = useState<Set<number>>(new Set());

  const toggleFolder = (folderId: number) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  return (
    <div className="divide-y divide-slate-700">
      {folders.map((folder) => (
        <div key={folder.id}>
          <button
            onClick={() => toggleFolder(folder.id)}
            aria-expanded={expandedFolders.has(folder.id)}
            className="w-full flex items-center gap-4 p-4 hover:bg-slate-800 transition-colors touch-manipulation"
          >
            <div className="w-12 h-12 bg-slate-700 rounded-lg flex items-center justify-center">
              {folder.iconEmoji || <FolderOpen className="w-6 h-6 text-slate-400" />}
            </div>
            <div className="flex-1 text-left">
              <p className="font-medium text-white">{folder.title}</p>
              <p className="text-sm text-slate-400">
                {t('{count} channels', { count: folder.channelCount })}
              </p>
            </div>
            <ChevronRight
              className={`w-5 h-5 text-slate-500 transition-transform ${
                expandedFolders.has(folder.id) ? 'rotate-90' : ''
              }`}
            />
          </button>
          {expandedFolders.has(folder.id) && (
            <div className="bg-slate-800/50">
              {folder.channels.map((channel) => (
                <button
                  key={channel.id}
                  onClick={() => onSelectChannel(channel)}
                  className="w-full flex items-center gap-4 p-4 pl-8 hover:bg-slate-700 transition-colors touch-manipulation"
                >
                  <ChannelAvatar channelId={channel.id} name={channel.name} size="sm" />
                  <span className="flex-1 text-left text-white truncate">
                    {channel.name}
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-500" />
                </button>
              ))}
            </div>
          )}
        </div>
      ))}

      {ungroupedChannels.length > 0 && (
        <>
          <div className="px-4 py-2 bg-slate-800">
            <span className="text-xs text-slate-400 uppercase">{t('Ungrouped')}</span>
          </div>
          {ungroupedChannels.map((channel) => (
            <button
              key={channel.id}
              onClick={() => onSelectChannel(channel)}
              className="w-full flex items-center gap-4 p-4 hover:bg-slate-800 transition-colors touch-manipulation"
            >
              <ChannelAvatar channelId={channel.id} name={channel.name} size="sm" />
              <span className="flex-1 text-left text-white truncate">
                {channel.name}
              </span>
              <ChevronRight className="w-4 h-4 text-slate-500" />
            </button>
          ))}
        </>
      )}
    </div>
  );
}
