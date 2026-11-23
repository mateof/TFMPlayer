/**
 * Themes. Tailwind 4 resolves every colour utility through a CSS variable
 * (`bg-emerald-500` → `var(--color-emerald-500)`), so a theme simply redefines
 * those variables on <html>: the accent palette is written over the emerald
 * scale and the background palette over the slate scale (plus white/black
 * for the light theme). No component needs to know which theme is active.
 */

export type AccentId = 'emerald' | 'ocean' | 'violet' | 'sunset' | 'rose' | 'amber';
export type BackgroundId = 'slate' | 'midnight' | 'amoled' | 'light';

export const SHADES = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'] as const;
export type Shade = (typeof SHADES)[number];
export type Palette = Record<Shade, string>;

// Tailwind's own palettes (hex), so every accent looks like the default one
const emerald: Palette = { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669', 700: '#047857', 800: '#065f46', 900: '#064e3b', 950: '#022c22' };
const sky: Palette = { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7', 700: '#0369a1', 800: '#075985', 900: '#0c4a6e', 950: '#082f49' };
const violet: Palette = { 50: '#f5f3ff', 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa', 500: '#8b5cf6', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6', 900: '#4c1d95', 950: '#2e1065' };
const orange: Palette = { 50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 500: '#f97316', 600: '#ea580c', 700: '#c2410c', 800: '#9a3412', 900: '#7c2d12', 950: '#431407' };
const rose: Palette = { 50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185', 500: '#f43f5e', 600: '#e11d48', 700: '#be123c', 800: '#9f1239', 900: '#881337', 950: '#4c0519' };
const amber: Palette = { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706', 700: '#b45309', 800: '#92400e', 900: '#78350f', 950: '#451a03' };

export const ACCENTS: { id: AccentId; label: string; palette: Palette }[] = [
  { id: 'emerald', label: 'Emerald', palette: emerald },
  { id: 'ocean', label: 'Ocean', palette: sky },
  { id: 'violet', label: 'Violet', palette: violet },
  { id: 'sunset', label: 'Sunset', palette: orange },
  { id: 'rose', label: 'Rose', palette: rose },
  { id: 'amber', label: 'Amber', palette: amber }
];

const slate: Palette = { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a', 950: '#020617' };
// Deep blue-black
const midnight: Palette = { 50: '#f5f7ff', 100: '#e8ecfb', 200: '#cdd5f3', 300: '#a7b3dd', 400: '#7f8bb8', 500: '#5b6591', 600: '#3e4670', 700: '#2a3157', 800: '#1a1f3d', 900: '#0f1229', 950: '#070818' };
// Pure black for OLED screens (saves battery)
const amoled: Palette = { 50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8', 400: '#a1a1aa', 500: '#71717a', 600: '#3f3f46', 700: '#27272a', 800: '#131316', 900: '#000000', 950: '#000000' };
// Light: the slate scale reversed, so "dark surface / light text" classes
// become "light surface / dark text"
const light: Palette = { 50: '#020617', 100: '#0f172a', 200: '#1e293b', 300: '#334155', 400: '#475569', 500: '#64748b', 600: '#94a3b8', 700: '#cbd5e1', 800: '#e2e8f0', 900: '#f8fafc', 950: '#ffffff' };

export const BACKGROUNDS: { id: BackgroundId; label: string; palette: Palette; isLight?: boolean }[] = [
  { id: 'slate', label: 'Slate', palette: slate },
  { id: 'midnight', label: 'Midnight', palette: midnight },
  { id: 'amoled', label: 'AMOLED black', palette: amoled },
  { id: 'light', label: 'Light', palette: light, isLight: true }
];

export function accentPalette(id: AccentId): Palette {
  return (ACCENTS.find((a) => a.id === id) ?? ACCENTS[0]).palette;
}

export function backgroundOf(id: BackgroundId) {
  return BACKGROUNDS.find((b) => b.id === id) ?? BACKGROUNDS[0];
}

// ---- Dynamic colour from the cover --------------------------------------------

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (x: number) => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

// Lightness ramp of Tailwind palettes, so a generated scale behaves the same
const LIGHTNESS: Record<Shade, number> = { 50: 97, 100: 93, 200: 86, 300: 76, 400: 64, 500: 52, 600: 43, 700: 36, 800: 29, 900: 24, 950: 14 };

/** A full accent palette for a hue (saturation clamped to stay readable). */
export function paletteFromHue(hue: number, saturation: number): Palette {
  const s = Math.max(45, Math.min(85, saturation));
  const out = {} as Palette;
  for (const shade of SHADES) out[shade] = hslToHex(hue, s, LIGHTNESS[shade]);
  return out;
}

/**
 * Dominant vivid colour of an image as hue/saturation, or null when the image
 * is essentially grey (then the theme accent is kept).
 */
export function dominantHue(img: HTMLImageElement): { hue: number; saturation: number } | null {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, size, size);
  const { data } = ctx.getImageData(0, 0, size, size);

  // Hue histogram weighted by saturation, ignoring near-black/white pixels
  const bins = new Array(36).fill(0);
  const satSum = new Array(36).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i] / 255, g = data[i + 1] / 255, b = data[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d < 0.08 || l < 0.12 || l > 0.92) continue;
    const s = d / (1 - Math.abs(2 * l - 1));
    let h: number;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const bin = Math.floor(h / 10);
    bins[bin] += s;
    satSum[bin] += s;
  }
  let best = -1;
  for (let i = 0; i < bins.length; i++) if (best < 0 || bins[i] > bins[best]) best = i;
  if (best < 0 || bins[best] < 3) return null;
  const pixels = data.length / 4;
  return { hue: best * 10 + 5, saturation: Math.round(Math.min(1, (satSum[best] / pixels) * 4 + 0.4) * 100) };
}
