'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../stores/authStore';

const INACTIVITY_TIMEOUT = 2 * 60 * 60 * 1000; // 2 часа
const STORAGE_KEY = 'pundit_last_activity';
const CHECK_INTERVAL = 60 * 1000; // проверка каждую минуту

export function useInactivityLogout() {
  const { user, logout } = useAuthStore();
  const router = useRouter();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!user) return;

    const updateActivity = () => {
      localStorage.setItem(STORAGE_KEY, String(Date.now()));
    };

    // Инициализируем время при монтировании
    if (!localStorage.getItem(STORAGE_KEY)) {
      updateActivity();
    }

    const events = ['mousemove', 'click', 'keydown', 'touchstart', 'scroll', 'pointerdown'];
    events.forEach((e) => document.addEventListener(e, updateActivity, { passive: true }));

    intervalRef.current = setInterval(async () => {
      const last = Number(localStorage.getItem(STORAGE_KEY) || '0');
      if (last > 0 && Date.now() - last > INACTIVITY_TIMEOUT) {
        clearInterval(intervalRef.current!);
        events.forEach((e) => document.removeEventListener(e, updateActivity));
        localStorage.removeItem(STORAGE_KEY);
        await logout();
        router.push('/auth/login?reason=inactivity');
      }
    }, CHECK_INTERVAL);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      events.forEach((e) => document.removeEventListener(e, updateActivity));
    };
  }, [user, logout, router]);
}
