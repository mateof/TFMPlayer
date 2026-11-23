import { NavLink } from 'react-router-dom';
import { Radio, ListMusic, Download, Settings, Search } from 'lucide-react';
import { t } from '@/i18n';

const tabs = [
  { to: '/channels', icon: Radio, label: t('Channels') },
  { to: '/search', icon: Search, label: t('Search') },
  { to: '/playlists', icon: ListMusic, label: t('Playlists') },
  { to: '/downloads', icon: Download, label: t('Downloads') },
  { to: '/settings', icon: Settings, label: t('Settings') }
];

export function TabBar() {
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-slate-800 border-t border-slate-700 safe-area-bottom z-40" aria-label={t('Main navigation')}>
      <div className="flex justify-around items-center h-16">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center w-full h-full gap-1 transition-colors touch-manipulation ${
                isActive ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
              }`
            }
          >
            <Icon className="w-5 h-5" aria-hidden />
            <span className="text-xs">{label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
