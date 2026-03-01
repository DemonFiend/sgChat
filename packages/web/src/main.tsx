import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isElectron } from './lib/electron';
import './styles/index.css';

// Flag Electron environment on <html> for CSS hooks
if (isElectron()) {
  document.documentElement.setAttribute('data-electron', 'true');
}

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

createRoot(root).render(<App />);
