'use client';

import { useEffect } from 'react';
import { authApi, resolveBackendBaseUrl } from '../api';
import { useAuthStore } from '../stores/authStore';

const HEARTBEAT_INTERVAL_MS = 60 * 1000;

export function useAuthPresence() {
  const { user } = useAuthStore();

  useEffect(() => {
    if (!user || typeof window === 'undefined') return;

    const baseUrl = resolveBackendBaseUrl();
    let heartbeatInFlight = false;

    const sendActivePresence = async () => {
      if (heartbeatInFlight) return;

      heartbeatInFlight = true;
      try {
        await authApi.presence(true);
      } catch {
        // Best-effort only: auth checks and logout flows already handle invalid sessions.
      } finally {
        heartbeatInFlight = false;
      }
    };

    const sendInactivePresence = () => {
      try {
        void window.fetch(`${baseUrl}/api/auth/presence`, {
          method: 'POST',
          credentials: 'include',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ active: false }),
        });
      } catch {
        // Ignore unload-time network failures and rely on heartbeat TTL cleanup.
      }
    };

    const handleFocus = () => {
      void sendActivePresence();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'hidden') {
        void sendActivePresence();
      }
    };

    const handlePageShow = () => {
      void sendActivePresence();
    };

    const handlePageHide = () => {
      sendInactivePresence();
    };

    void sendActivePresence();

    const intervalId = window.setInterval(() => {
      void sendActivePresence();
    }, HEARTBEAT_INTERVAL_MS);

    window.addEventListener('focus', handleFocus);
    window.addEventListener('online', handleFocus);
    window.addEventListener('pageshow', handlePageShow);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('online', handleFocus);
      window.removeEventListener('pageshow', handlePageShow);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user?.id]);
}
