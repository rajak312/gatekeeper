'use client';

import type { CurrentUser } from '@gatekeeper/shared';
import { useRouter } from 'next/navigation';
import useSWR, { useSWRConfig } from 'swr';
import { api } from './api';

export function useMe() {
  return useSWR<CurrentUser, Error>('/api/auth/me');
}

/** Ends the Gatekeeper session, drops every cached API response and navigates to `to`. */
export function useSignOut() {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  return async (to = '/login') => {
    await api('/api/auth/logout', { method: 'POST', body: {} }).catch(() => undefined);
    await mutate(() => true, undefined, { revalidate: false });
    router.replace(to);
  };
}
