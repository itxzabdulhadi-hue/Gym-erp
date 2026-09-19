import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/index.css';
import { restoreCachedAppearance } from './lib/themeEngine';

// Paint the tenant's last known palette before React mounts, so a returning
// user does not see the default theme flash for a frame.
restoreCachedAppearance();

const container = document.getElementById('root');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
