import { useEffect, useState } from 'react';
import { useSettingsStore } from '@/stores/settingsStore';
import { usePlayerStore } from '@/stores/playerStore';
import { useCoverArt } from '@/hooks/useCoverArt';
import { accentPalette, backgroundOf, dominantHue, paletteFromHue, SHADES, type Palette, type Shade } from './themes';

// In the light theme the light accent shades (used as text on dark) would be
// unreadable on white: use the darker ones instead
const LIGHT_ACCENT_MAP: Partial<Record<Shade, Shade>> = { 200: '700', 300: '700', 400: '600', 500: '600' };

function writePalette(root: HTMLElement, name: string, palette: Palette, remap?: Partial<Record<Shade, Shade>>) {
  for (const shade of SHADES) {
    root.style.setProperty(`--color-${name}-${shade}`, palette[remap?.[shade] ?? shade]);
  }
}

function setMetaThemeColor(color: string) {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
  }
  meta.content = color;
}

/** Accent extracted from the current cover (null = use the chosen accent). */
function useCoverPalette(enabled: boolean): Palette | null {
  const fileId = usePlayerStore((s) => s.currentTrack?.fileId);
  const cover = useCoverArt(enabled ? fileId : undefined);
  const [palette, setPalette] = useState<{ cover: string; palette: Palette | null } | null>(null);

  useEffect(() => {
    if (!enabled || !cover) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      try {
        const dominant = dominantHue(img);
        setPalette({ cover, palette: dominant ? paletteFromHue(dominant.hue, dominant.saturation) : null });
      } catch {
        setPalette({ cover, palette: null });
      }
    };
    img.src = cover;
    return () => {
      cancelled = true;
    };
  }, [enabled, cover]);

  return enabled && cover && palette?.cover === cover ? palette.palette : null;
}

/**
 * Applies the appearance settings to <html>: colour variables, light/dark
 * scheme, browser theme colour and the reduced-motion switch. Renders nothing.
 */
export function ThemeController() {
  const accent = useSettingsStore((s) => s.accent);
  const background = useSettingsStore((s) => s.background);
  const dynamicColor = useSettingsStore((s) => s.dynamicColor);
  const reduceMotion = useSettingsStore((s) => s.reduceMotion);
  const coverPalette = useCoverPalette(dynamicColor);

  useEffect(() => {
    const root = document.documentElement;
    const bg = backgroundOf(background);
    const accentColors = coverPalette ?? accentPalette(accent);

    writePalette(root, 'slate', bg.palette);
    writePalette(root, 'emerald', accentColors, bg.isLight ? LIGHT_ACCENT_MAP : undefined);
    if (bg.isLight) {
      root.style.setProperty('--color-white', '#0f172a');
      root.style.colorScheme = 'light';
    } else {
      root.style.removeProperty('--color-white');
      root.style.colorScheme = 'dark';
    }
    root.dataset.theme = bg.id;
    setMetaThemeColor(bg.palette['900']);
  }, [accent, background, coverPalette]);

  useEffect(() => {
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);

  return null;
}
