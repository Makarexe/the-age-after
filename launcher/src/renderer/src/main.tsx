import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

async function start() {
  // Browser preview (npm run preview:ui) has no Electron: use a fake bridge.
  if (import.meta.env.VITE_UI_PREVIEW === '1' && !window.launcherBridge) await import('./mock').then((m) => m.installMock());
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
