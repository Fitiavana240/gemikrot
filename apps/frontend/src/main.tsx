import { StrictMode } from 'react';
// Avant le rendu : sinon l'application s'affiche en clair une fraction de
// seconde avant de basculer, et ce clignotement blanc est exactement ce
// qu'on cherche a eviter le soir.
installerTheme();

import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './index.css';
import { installerTheme } from './theme';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 10_000 } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
