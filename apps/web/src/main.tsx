import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { LocaleProvider } from './i18n/index';

const rootEl = document.getElementById('root');
if (rootEl === null) {
  throw new Error('apps/web: #root element not found in index.html');
}

createRoot(rootEl).render(
  <StrictMode>
    {/* M005-S01-T4: default locale EN — render behavior-identical (§7.1.1). */}
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
