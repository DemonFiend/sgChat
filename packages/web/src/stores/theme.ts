import { createSignal, createRoot } from 'solid-js';

export type Theme = 'dark' | 'light' | 'oled' | 'nord';

const STORAGE_KEY = 'sgchat-theme';

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  
  const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
  if (stored && ['dark', 'light', 'oled', 'nord'].includes(stored)) {
    return stored;
  }
  
  // Check system preference
  if (window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  
  return 'dark';
}

// Apply theme to document
function applyTheme(newTheme: Theme) {
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem(STORAGE_KEY, newTheme);
}

// Create theme store inside a root to avoid memory leak warning
const { theme, setTheme, toggleTheme } = createRoot(() => {
  const [themeSignal, setThemeSignal] = createSignal<Theme>(getInitialTheme());

  // Initialize on load
  if (typeof window !== 'undefined') {
    applyTheme(themeSignal());
  }

  const setThemeValue = (newTheme: Theme) => {
    setThemeSignal(newTheme);
    applyTheme(newTheme);
  };

  const toggleThemeValue = () => {
    const themes: Theme[] = ['dark', 'light', 'oled', 'nord'];
    const currentIndex = themes.indexOf(themeSignal());
    const nextIndex = (currentIndex + 1) % themes.length;
    setThemeValue(themes[nextIndex]);
  };

  return {
    theme: themeSignal,
    setTheme: setThemeValue,
    toggleTheme: toggleThemeValue,
  };
});

export const themeNames: Record<Theme, string> = {
  dark: 'Dark',
  light: 'Light',
  oled: 'OLED Black',
  nord: 'Nord',
};

export { theme, setTheme, toggleTheme };
