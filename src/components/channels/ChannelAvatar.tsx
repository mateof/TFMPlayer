import { useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { buildBaseUrl } from '@/services/api/client';

// Channels without a photo answer 404: remember them so lists that remount
// don't ask the server again in this session
const missingAvatars = new Set<string>();
let baseUrlPromise: Promise<string> | null = null;

function useServerBaseUrl(): string | null {
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!baseUrlPromise) baseUrlPromise = buildBaseUrl().catch(() => '');
    let active = true;
    baseUrlPromise.then((url) => {
      if (active) setBaseUrl(url || null);
    });
    return () => {
      active = false;
    };
  }, []);
  return baseUrl;
}

const sizes = {
  sm: { box: 'w-8 h-8', icon: 'w-4 h-4', text: 'text-xs' },
  md: { box: 'w-12 h-12', icon: 'w-6 h-6', text: 'text-sm' },
  lg: { box: 'w-14 h-14', icon: 'w-7 h-7', text: 'text-base' }
};

interface ChannelAvatarProps {
  channelId: string | number;
  name?: string;
  size?: keyof typeof sizes;
}

/**
 * Channel photo served by TelegramFileManager (`/api/channel/image/{id}`,
 * public and cached by the server), with the initial as fallback.
 */
export function ChannelAvatar({ channelId, name, size = 'md' }: ChannelAvatarProps) {
  const id = String(channelId);
  const baseUrl = useServerBaseUrl();
  const [failed, setFailed] = useState(() => missingAvatars.has(id));
  const s = sizes[size];

  const initial = name?.trim().charAt(0).toUpperCase();

  return (
    <div className={`${s.box} rounded-full bg-slate-700 flex items-center justify-center shrink-0 overflow-hidden`} aria-hidden>
      {baseUrl && !failed ? (
        <img
          src={`${baseUrl}/api/channel/image/${encodeURIComponent(id)}`}
          alt=""
          loading="lazy"
          decoding="async"
          className="w-full h-full object-cover"
          onError={() => {
            missingAvatars.add(id);
            setFailed(true);
          }}
        />
      ) : initial ? (
        <span className={`${s.text} font-semibold text-slate-300`}>{initial}</span>
      ) : (
        <Radio className={`${s.icon} text-slate-400`} />
      )}
    </div>
  );
}
