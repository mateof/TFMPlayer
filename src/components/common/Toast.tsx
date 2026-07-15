import { useEffect } from 'react';
import { X, CheckCircle, AlertCircle, Info, AlertTriangle } from 'lucide-react';
import { useUiStore } from '@/stores/uiStore';

export function ToastContainer() {
  const { toasts, removeToast } = useUiStore();

  if (toasts.length === 0) return null;

  return (
    // z-[60]: must render above the expanded player overlay (z-50)
    <div className="fixed bottom-20 left-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
      ))}
    </div>
  );
}

interface ToastProps {
  toast: {
    id: string;
    message: string;
    type: 'success' | 'error' | 'info' | 'warning';
  };
  onClose: () => void;
}

function Toast({ toast, onClose }: ToastProps) {
  const icons = {
    success: <CheckCircle className="w-5 h-5 text-emerald-400" />,
    error: <AlertCircle className="w-5 h-5 text-red-400" />,
    info: <Info className="w-5 h-5 text-blue-400" />,
    warning: <AlertTriangle className="w-5 h-5 text-yellow-400" />
  };

  const backgrounds = {
    success: 'bg-emerald-900/90 border-emerald-700',
    error: 'bg-red-900/90 border-red-700',
    info: 'bg-blue-900/90 border-blue-700',
    warning: 'bg-yellow-900/90 border-yellow-700'
  };

  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div
      className={`
        flex items-center gap-3 px-4 py-3 rounded-lg border
        backdrop-blur-sm shadow-lg pointer-events-auto
        animate-in slide-in-from-bottom-2 fade-in duration-200
        ${backgrounds[toast.type]}
      `}
    >
      {icons[toast.type]}
      <p className="flex-1 text-sm text-white">{toast.message}</p>
      <button
        onClick={onClose}
        className="text-slate-400 hover:text-white transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
