import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Console banner
const APP_VERSION = '1.0.0';
const REPO_URL = 'https://github.com/mateof/TFMPlayer';

console.log(
  `%c
  ████████╗███████╗███╗   ███╗
  ╚══██╔══╝██╔════╝████╗ ████║
     ██║   █████╗  ██╔████╔██║
     ██║   ██╔══╝  ██║╚██╔╝██║
     ██║   ██║     ██║ ╚═╝ ██║
     ╚═╝   ╚═╝     ╚═╝     ╚═╝
  %c TFM Audio Player %c v${APP_VERSION} %c

  %c${REPO_URL}%c
  `,
  'color: #10b981; font-family: monospace; font-weight: bold;',
  'background: #10b981; color: #000; padding: 4px 8px; border-radius: 4px 0 0 4px; font-weight: bold;',
  'background: #1e293b; color: #10b981; padding: 4px 8px; border-radius: 0 4px 4px 0;',
  '',
  'color: #64748b; text-decoration: underline;',
  ''
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
