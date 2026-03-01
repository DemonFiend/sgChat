import { create } from 'zustand';

export type Theme = 'midnight' | 'dark' | 'light' | 'oled' | 'nord';

const STORAGE_KEY = 'sgchat-theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'midnight';
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored && ['midnight', 'dark', 'light', 'oled', 'nord'].includes(stored)) return stored;
  if (window.matchMedia('(prefers-color-scheme: light)').matches) return 'light';
  return 'midnight';
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
      const themes: Theme[] = ['midnight', 'dark', 'light', 'oled', 'nord'];
      const currentIndex = themes.indexOf(get().theme);
      const nextTheme = themes[(currentIndex + 1) % themes.length];
      set({ theme: nextTheme });
      applyTheme(nextTheme);
    },
  };
});

export const themeNames: Record<Theme, string> = {
  midnight: 'Midnight',
  dark: 'Dark',
  light: 'Light',
  oled: 'OLED Black',
  nord: 'Nord',
};
