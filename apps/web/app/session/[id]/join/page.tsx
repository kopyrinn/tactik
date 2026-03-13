'use client';

import { useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { sessionsApi } from '@/lib/api';

export default function SessionJoinPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = params?.id;
  const incomingQuery = searchParams.toString();

  useEffect(() => {
    let cancelled = false;

    const resolveJoinRoute = async () => {
      if (!sessionId) {
        router.replace('/');
        return;
      }

      const nextQuery = new URLSearchParams(incomingQuery);
      const hasDemoHint = nextQuery.get('demo') === '1';

      // Fast path: demo markers already present in URL.
      if (hasDemoHint) {
        router.replace(`/session/${sessionId}${incomingQuery ? `?${incomingQuery}` : ''}`);
        return;
      }

      // Fallback for old QR links without demo params.
      try {
        const response = await sessionsApi.getPublic(sessionId);
        if (cancelled) return;

        if (response.success && response.data?.isDemo) {
          nextQuery.set('demo', '1');
          if (response.data.demoExpiresAt) {
            nextQuery.set('expiresAt', response.data.demoExpiresAt);
          }
          if (response.data.demoRoomCode) {
            nextQuery.set('room', response.data.demoRoomCode);
          }
        }
      } catch {
        if (cancelled) return;
      }

      const query = nextQuery.toString();
      router.replace(`/session/${sessionId}${query ? `?${query}` : ''}`);
    };

    void resolveJoinRoute();

    return () => {
      cancelled = true;
    };
  }, [incomingQuery, router, sessionId]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <div className="w-10 h-10 border-4 border-ucl-gold border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <p className="text-white/60 text-sm">Подключение к сессии...</p>
      </div>
    </div>
  );
}
