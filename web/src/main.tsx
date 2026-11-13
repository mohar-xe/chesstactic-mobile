import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './i18n';
import './index.css';
import { initDatabase } from './storage/db';
import { useProfile } from './storage/profile';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

async function boot() {
  await initDatabase();
  await useProfile.getState().load();

  const root = document.getElementById('root');
  if (!root) throw new Error('#root missing');
  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  );
}

void boot();
