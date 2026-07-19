// 10-band EQ center frequencies (Hz) used by the DSP chain
export const EQ_BANDS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_BAND_LABELS = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];

// Preset gains in dB per band
export const EQ_PRESETS: { key: string; label: string; gains: number[] }[] = [
  { key: 'flat', label: 'Flat', gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { key: 'rock', label: 'Rock', gains: [5, 4, 3, 1, -1, -1, 0, 2, 3, 4] },
  { key: 'pop', label: 'Pop', gains: [-1, 1, 3, 4, 4, 2, 0, -1, -1, -1] },
  { key: 'jazz', label: 'Jazz', gains: [3, 2, 1, 2, -1, -1, 0, 1, 2, 3] },
  { key: 'classical', label: 'Classical', gains: [4, 3, 2, 0, -1, -1, 0, 2, 3, 4] },
  { key: 'electronic', label: 'Electronic', gains: [4, 3, 1, 0, -1, 1, 0, 1, 3, 4] },
  { key: 'bass', label: 'Bass Boost', gains: [7, 6, 5, 3, 1, 0, 0, 0, 0, 0] },
  { key: 'vocal', label: 'Vocal', gains: [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1] }
];
