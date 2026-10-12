import { useColorScheme } from 'react-native';

const light = {
  dark: false,
  background: '#f2f2f7',
  surface: '#ffffff',
  surfaceAlt: '#f2f2ef',
  text: '#16191d',
  textSecondary: '#4a5059',
  muted: '#8a8f98',
  separator: '#e2e2de',
  brand: '#0f3d3e',
  onBrand: '#ffffff',
  brandSoft: '#e3efeb',
  star: '#e6a417',
  starOff: '#d6d6d1',
  danger: '#b4441f',
};

const dark: typeof light = {
  dark: true,
  background: '#000000',
  surface: '#1c1c1e',
  surfaceAlt: '#2c2c2e',
  text: '#f2f2f2',
  textSecondary: '#c2c6cc',
  muted: '#8e939b',
  separator: '#38383a',
  brand: '#7fd1b0',
  onBrand: '#0b1f1a',
  brandSoft: '#18302a',
  star: '#f0b429',
  starOff: '#48484a',
  danger: '#ff7a59',
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const ratingColor = (r: number | null) =>
  r == null ? '#8e8e93' : r >= 4 ? '#1d7a5c' : r >= 2.5 ? '#b7791f' : '#b4441f';

export const formatRating = (r: number | null) => (r == null ? '–' : r.toFixed(1));

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
