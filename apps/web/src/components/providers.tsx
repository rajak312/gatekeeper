'use client';

import { ThemeProvider } from 'next-themes';
import type { ReactNode } from 'react';
import { SWRConfig } from 'swr';
import { fetcher, ApiError } from '@/lib/api';
import { ToastProvider } from './ui/toast';

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <SWRConfig
        value={{
          fetcher,
          revalidateOnFocus: false,
          shouldRetryOnError: (err) => !(err instanceof ApiError && err.status < 500),
        }}
      >
        <ToastProvider>{children}</ToastProvider>
      </SWRConfig>
    </ThemeProvider>
  );
}
