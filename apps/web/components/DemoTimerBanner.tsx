'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { authApi } from '@/lib/api';
import { DEMO_AUTH_STORAGE_EVENT, DEMO_AUTH_STORAGE_KEY, clearDemoAuthMarker } from '@/lib/constants/demo';

type DemoAuthMarker = {
  expiresAt: string;
  login?: string;
};

function parseMarker(raw: string | null): DemoAuthMarker | null {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<DemoAuthMarker>;
    if (!parsed || typeof parsed.expiresAt !== 'string') {
      return null;
    }
    return {
      expiresAt: parsed.expiresAt,
      login: typeof parsed.login === 'string' ? parsed.login : undefined,
    };
  } catch {
    return null;
  }
}

function getSecondsLeft(expiresAt: string) {
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return 0;
  return Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
}

export default function DemoTimerBanner() {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthPage = pathname.startsWith('/auth');
  const isSessionPage = pathname.startsWith('/session/');
  const [marker, setMarker] = useState<DemoAuthMarker | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const isFinishingRef = useRef(false);

  useEffect(() => {
    const refreshFromStorage = () => {
      const nextMarker = parseMarker(localStorage.getItem(DEMO_AUTH_STORAGE_KEY));
      setMarker(nextMarker);
      setSecondsLeft(nextMarker ? getSecondsLeft(nextMarker.expiresAt) : 0);
    };

    refreshFromStorage();
    window.addEventListener('storage', refreshFromStorage);
    window.addEventListener(DEMO_AUTH_STORAGE_EVENT, refreshFromStorage);
    return () => {
      window.removeEventListener('storage', refreshFromStorage);
      window.removeEventListener(DEMO_AUTH_STORAGE_EVENT, refreshFromStorage);
    };
  }, []);

  useEffect(() => {
    const nextMarker = parseMarker(localStorage.getItem(DEMO_AUTH_STORAGE_KEY));
    setMarker(nextMarker);
    setSecondsLeft(nextMarker ? getSecondsLeft(nextMarker.expiresAt) : 0);
  }, [pathname]);

  useEffect(() => {
    if (!marker) return;

    const timer = setInterval(() => {
      setSecondsLeft(getSecondsLeft(marker.expiresAt));
    }, 1000);

    return () => clearInterval(timer);
  }, [marker]);

  useEffect(() => {
    if (!marker) return;
    if (secondsLeft > 0) return;
    if (isFinishingRef.current) return;

    isFinishingRef.current = true;
    clearDemoAuthMarker();

    (async () => {
      try {
        await authApi.logout();
      } catch {}

      setMarker(null);
      setSecondsLeft(0);

      if (!pathname.startsWith('/auth/login')) {
        router.replace('/auth/login?reason=demo_expired');
      }
      isFinishingRef.current = false;
    })();
  }, [marker, pathname, router, secondsLeft]);

  const formatted = useMemo(() => {
    const mins = Math.floor(secondsLeft / 60);
    const secs = secondsLeft % 60;
    return `${mins}:${String(secs).padStart(2, '0')}`;
  }, [secondsLeft]);

  if (!marker || secondsLeft <= 0) {
    return null;
  }

  if (isAuthPage || isSessionPage) {
    return null;
  }

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[300] pointer-events-none"
      style={{ top: 'calc(env(safe-area-inset-top, 0px) + 8px)' }}
    >
      <div className="px-4 py-1.5 rounded-full bg-black/60 border border-ucl-gold/75 text-ucl-gold text-sm font-black tabular-nums shadow-[0_6px_24px_rgba(0,0,0,0.4)]">
        {formatted}
      </div>
    </div>
  );
}
