import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import './styles/tokens.css';
import './styles/components.css';
import './styles/app.css';
import './styles/camera.css';
import { App } from './App';

// The demo inside a Claude artifact can't use URL paths, so it keeps routes in memory (VITE_ROUTER=memory).
// Everywhere else (the server app, the GitHub Pages phone demo) uses real URLs under the build's base path.
const memory = import.meta.env.VITE_ROUTER === 'memory';
const basename = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '') || '/';
const Router = ({ children }: { children: React.ReactNode }) =>
  memory ? <MemoryRouter>{children}</MemoryRouter> : <BrowserRouter basename={basename}>{children}</BrowserRouter>;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Router>
      <App />
    </Router>
  </StrictMode>,
);
