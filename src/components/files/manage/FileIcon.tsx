import { useState } from 'react';
import {
  Music, Folder, Film, Image as ImageIcon, FileText, FileArchive, Package, File as FileIcon2, FileType
} from 'lucide-react';
import { extensionOf } from '@/services/files/fileManager';
import type { ChannelFile } from '@/types/models';

const iconClass = 'w-5 h-5';

/** Icon and tint of each category (type icons of Manage mode). */
function categoryVisual(file: ChannelFile): { icon: React.ReactNode; tint: string } {
  switch (file.category) {
    case 'Folder':
      return { icon: <Folder className={iconClass} aria-hidden />, tint: 'bg-yellow-500/20 text-yellow-400' };
    case 'Audio':
      return { icon: <Music className={iconClass} aria-hidden />, tint: 'bg-emerald-500/20 text-emerald-400' };
    case 'Video':
      return { icon: <Film className={iconClass} aria-hidden />, tint: 'bg-sky-500/20 text-sky-400' };
    case 'Photo':
      return { icon: <ImageIcon className={iconClass} aria-hidden />, tint: 'bg-fuchsia-500/20 text-fuchsia-400' };
    case 'Archive':
      return { icon: <FileArchive className={iconClass} aria-hidden />, tint: 'bg-amber-500/20 text-amber-400' };
    case 'Application':
      return { icon: <Package className={iconClass} aria-hidden />, tint: 'bg-violet-500/20 text-violet-400' };
    case 'Document':
      return extensionOf(file.name) === 'pdf'
        ? { icon: <FileType className={iconClass} aria-hidden />, tint: 'bg-red-500/20 text-red-400' }
        : { icon: <FileText className={iconClass} aria-hidden />, tint: 'bg-slate-500/30 text-slate-300' };
    default:
      return { icon: <FileIcon2 className={iconClass} aria-hidden />, tint: 'bg-slate-500/30 text-slate-300' };
  }
}

/**
 * Square tile with the type icon, or the thumbnail when the server has one
 * (falls back to the icon if the image fails, e.g. a message without preview).
 */
export function FileThumb({ file, thumbnailUrl, className = 'w-10 h-10', rounded = 'rounded-lg' }: {
  file: ChannelFile;
  thumbnailUrl?: string;
  className?: string;
  rounded?: string;
}) {
  const [failed, setFailed] = useState(false);
  const { icon, tint } = categoryVisual(file);
  if (thumbnailUrl && !failed) {
    return (
      <img
        src={thumbnailUrl}
        alt=""
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={`${className} ${rounded} object-cover bg-slate-800 shrink-0`}
      />
    );
  }
  return <div className={`${className} ${rounded} ${tint} flex items-center justify-center shrink-0`}>{icon}</div>;
}
