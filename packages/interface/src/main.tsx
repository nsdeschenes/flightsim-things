import {Tooltip} from '@base-ui/react/tooltip';
import {StrictMode} from 'react';
import {RouterProvider} from '@tanstack/react-router';
import {createRoot} from 'react-dom/client';
import {QueryClient, QueryClientProvider} from '@tanstack/react-query';
import {router} from './router';
import './reset.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {staleTime: Infinity, retry: false, networkMode: 'always'},
    mutations: {retry: false, networkMode: 'always'},
  },
});

const root = document.getElementById('root');
if (!root) {
  throw new Error('Missing root element');
}
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <Tooltip.Provider>
        <RouterProvider router={router} />
      </Tooltip.Provider>
    </QueryClientProvider>
  </StrictMode>
);
