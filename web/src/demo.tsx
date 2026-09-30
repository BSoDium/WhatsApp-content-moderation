import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import { DemoBanner } from './demo/DemoBanner.tsx'
import { createSeededBackend } from './demo/history.ts'
import { installDemoApi } from './demo/installDemoApi.ts'
import { startSimulator } from './demo/simulator.ts'
import { initSystemTheme } from './lib/theme.ts'
import App from './App.tsx'

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element was not found');

const backend = createSeededBackend(Date.now());
installDemoApi(backend);
startSimulator(backend);
initSystemTheme();

createRoot(rootElement).render(
  <StrictMode>
    <App />
    <DemoBanner />
  </StrictMode>,
)
