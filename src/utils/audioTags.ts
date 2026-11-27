import type { IAudioMetadata, IPicture } from 'music-metadata';
import { loadMusicMetadata } from './musicMetadata';

/** What the app keeps from the tags of an audio file. */
export interface AudioTags {
  title?: string;
  artist?: string;
  album?: string;
  duration?: number;
  /** data: URL of the first embedded picture. */
  coverArt?: string;
  /** Short codec label read from the file (MP3, AAC, FLAC...). */
  audioFormat?: string;
  /** kbps. */
  audioBitrate?: number;
  /** ReplayGain of the track in dB (falls back to the album gain). */
  replayGainDb?: number;
  /** ReplayGain peak (linear, 1 = full scale). */
  replayGainPeak?: number;
}

/** Base64 of some bytes, in chunks (one call per byte overflows on big covers). */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function pictureToDataUrl(picture: IPicture | undefined): string | undefined {
  if (!picture?.data?.length) return undefined;
  return `data:${picture.format || 'image/jpeg'};base64,${bytesToBase64(picture.data)}`;
}

/** Short, human-readable codec label from what the file actually contains. */
export function formatLabel(container?: string, codec?: string): string | undefined {
  const value = `${codec ?? ''} ${container ?? ''}`.toUpperCase();
  if (!value.trim()) return undefined;
  if (value.includes('AAC')) return 'AAC';
  if (value.includes('LAYER 3') || value.includes('MP3')) return 'MP3';
  if (value.includes('FLAC')) return 'FLAC';
  if (value.includes('OPUS')) return 'OPUS';
  if (value.includes('VORBIS')) return 'OGG';
  if (value.includes('PCM') || value.includes('WAVE')) return 'WAV';
  if (value.includes('ALAC')) return 'ALAC';
  return (codec || container)!.split(/[\s/]/)[0].slice(0, 8).toUpperCase();
}

/** The fields of {@link AudioTags} from a music-metadata result. */
export function tagsFromMetadata(mm: IAudioMetadata): AudioTags {
  const { common, format } = mm;
  const gain = common.replaygain_track_gain ?? common.replaygain_album_gain;
  const peak = common.replaygain_track_peak ?? common.replaygain_album_peak;
  return {
    title: common.title,
    artist: common.artist,
    album: common.album,
    duration: format.duration,
    coverArt: pictureToDataUrl(common.picture?.[0]),
    audioFormat: formatLabel(format.container, format.codec),
    audioBitrate: format.bitrate ? Math.round(format.bitrate / 1000) : undefined,
    replayGainDb: typeof gain?.dB === 'number' && Number.isFinite(gain.dB) ? gain.dB : undefined,
    replayGainPeak: typeof peak?.ratio === 'number' && Number.isFinite(peak.ratio) && peak.ratio > 0 ? peak.ratio : undefined
  };
}

/**
 * Tags of a whole file. parseBlob streams it instead of copying it whole into
 * memory. Never throws: a file without readable tags gives `{}`.
 */
export async function readBlobTags(blob: Blob): Promise<AudioTags> {
  try {
    return tagsFromMetadata(await (await loadMusicMetadata()).parseBlob(blob));
  } catch (error) {
    console.warn('Failed to read the tags:', error);
    return {};
  }
}
