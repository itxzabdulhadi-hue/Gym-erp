import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router-dom';
import { queryClient } from '@/lib/queryClient';
import { router } from './router';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { ToastProvider } from '@/components/ui/Toast';
import { ErrorBoundary } from '@/pages/errors/ErrorBoundary';

/**
 * Provider order matters:
 *   ErrorBoundary  - catches anything below, including the other providers
 *   Toast          - available to every screen, including the login page
 *   QueryClient    - data layer
 *   Auth           - needs the API client, which QueryClient does not own
 *   Theme          - reads branding and theme off the auth session
 *   Router         - rendered last so guards can read the session
 */
export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <ThemeProvider>
              <RouterProvider router={router} />
            </ThemeProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
