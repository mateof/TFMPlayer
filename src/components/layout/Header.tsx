import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MoreVertical } from 'lucide-react';
import type { ReactNode } from 'react';

interface HeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  backPath?: string;
  actions?: ReactNode;
}

export function Header({ title, subtitle, showBack = false, backPath, actions }: HeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (backPath) {
      navigate(backPath);
    } else {
      navigate(-1);
    }
  };

  return (
    <header className="sticky top-0 z-30 bg-slate-900/95 backdrop-blur-sm border-b border-slate-700 safe-area-top">
      <div className="flex items-center h-14 px-4 gap-3">
        {showBack && (
          <button
            onClick={handleBack}
            className="p-2 -ml-2 text-slate-400 hover:text-white transition-colors touch-manipulation"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5" aria-hidden />
          </button>
        )}
        <div className="flex-1 min-w-0">
          <h1 className="text-lg font-semibold text-white truncate">{title}</h1>
          {subtitle && (
            <p className="text-sm text-slate-400 truncate">{subtitle}</p>
          )}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}

interface HeaderActionProps {
  icon?: ReactNode;
  onClick: () => void;
  label?: string;
  disabled?: boolean;
}

export function HeaderAction({ icon, onClick, label, disabled }: HeaderActionProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-2 text-slate-400 hover:text-white transition-colors touch-manipulation disabled:opacity-50 disabled:cursor-not-allowed"
      aria-label={label}
      title={label}
    >
      {icon || <MoreVertical className="w-5 h-5" aria-hidden />}
    </button>
  );
}
