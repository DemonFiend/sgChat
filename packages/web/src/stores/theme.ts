import { create } from 'zustand';
import { isElectron } from '@/lib/electron';

export type Theme = 'midnight' | 'dark' | 'light' | 'oled' | 'nord';

const STORAGE_KEY = 'sgchat-theme';
const ALL_THEMES: Theme[] = ['midnight', 'dark', 'light', 'oled', 'nord'];

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'nord';
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored && ALL_THEMES.includes(stored)) return stored;
  if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  // Midnight is the default for the desktop app, Nord for the web
  return isElectron() ? 'midnight' : 'nord';
}

function applyTheme(newTheme: Theme) {
  // Suppress transitions on initial load to prevent flash
  document.documentElement.classList.add('no-theme-transition');
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem(STORAGE_KEY, newTheme);
  requestAnimationFrame(() => {
    document.documentElement.classList.remove('no-theme-transition');
  });
}

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

export const useThemeStore = create<ThemeState>((set, get) => {
  // Apply initial theme on load
  const initial = getInitialTheme();
  if (typeof window !== 'undefined') applyTheme(initial);

  return {
    theme: initial,
    setTheme: (newTheme) => {
      set({ theme: newTheme });
      applyTheme(newTheme);
    },
    toggleTheme: () => {
      const available = getAvailableThemes();
      const currentIndex = available.indexOf(get().theme);
      const nextTheme = available[(currentIndex + 1) % available.length];
      set({ theme: nextTheme });
      applyTheme(nextTheme);
    },
  };
});

export function getAvailableThemes(): Theme[] {
  return ALL_THEMES;
}

export const themeNames: Record<Theme, string> = {
  midnight: 'Midnight',
  dark: 'Dark',
  light: 'Light',
  oled: 'OLED Black',
  nord: 'Nord',
};
