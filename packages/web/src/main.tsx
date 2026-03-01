import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isElectron } from './lib/electron';
import { applyTheme, getInitialTheme } from './stores/theme';
import './styles/index.css';

// Apply theme before React renders (outside store constructor to avoid render conflicts)
applyTheme(getInitialTheme());

// Flag Electron environment on <html> for CSS hooks
if (isElectron()) {
  document.documentElement.setAttribute('data-electron', 'true');
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(<App />);
