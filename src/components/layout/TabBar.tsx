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
    <nav className="shrink-0 bg-slate-800/95 backdrop-blur border-t border-slate-700 safe-area-bottom z-40" aria-label={t('Main navigation')}>
      <div className="flex justify-around items-center h-16">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center w-full h-full gap-0.5 transition-colors touch-manipulation ${
                isActive ? 'text-emerald-400' : 'text-slate-400 hover:text-slate-200'
              }`
            }
          >
            {({ isActive }) => (
              <>
                {/* Active tab: icon inside a tinted pill */}
                <span className={`flex items-center justify-center w-14 h-7 rounded-full transition-colors ${isActive ? 'bg-emerald-500/15' : ''}`}>
                  <Icon className="w-5 h-5" aria-hidden />
                </span>
                <span className={`text-[11px] ${isActive ? 'font-semibold' : ''}`}>{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
