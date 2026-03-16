'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import { authApi, demoApi } from '@/lib/api';
import { DEMO_AUTH_STORAGE_KEY, clearDemoAuthMarker, setDemoAuthMarker } from '@/lib/constants/demo';

// Замените на реальный ID видео с YouTube (часть после ?v= или youtu.be/)
const PROMO_VIDEO_ID = 'H0X8p-c_qcc';

function LoginPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { login, checkAuth, isLoading, error, clearError } = useAuthStore();
  const redirectTo = searchParams.get('redirect');
  const reason = searchParams.get('reason');

  const [formData, setFormData] = useState({ login: '', password: '' });
  const [isDemoLoading, setIsDemoLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const clearStaleDemoMarker = async () => {
      const marker = localStorage.getItem(DEMO_AUTH_STORAGE_KEY);
      if (!marker) return;

      try {
        const response = await authApi.me();
        const isActiveDemoUser = Boolean(response.success && response.data?.email?.endsWith('@demo.local'));
        if (!isActiveDemoUser && !cancelled) {
          clearDemoAuthMarker();
        }
      } catch {
        if (!cancelled) {
          clearDemoAuthMarker();
        }
      }
    };

    clearStaleDemoMarker();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(formData.login, formData.password);
      router.push(redirectTo && redirectTo.startsWith('/') ? redirectTo : '/dashboard');
    } catch {}
  };

  const handleDemo = async () => {
    setIsDemoLoading(true);
    try {
      const response = await demoApi.start();
      setDemoAuthMarker({ expiresAt: response.expiresAt, login: response.login });
      await checkAuth();
      router.replace('/dashboard');
    } catch {
      setIsDemoLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center px-4 py-12">
      {isDemoLoading && (
        <div className="fixed inset-0 z-[400] bg-ucl-navy/90 backdrop-blur-sm flex items-center justify-center px-4">
          <div className="w-full max-w-md bg-white/5 border border-white/10 rounded-2xl p-7 text-center">
            <div className="w-12 h-12 border-4 border-ucl-gold border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <h3 className="text-xl font-black uppercase mb-2">Запускаем тестовый режим</h3>
            <p className="text-white/70 text-sm">
              Создаём временный аккаунт и подготавливаем сессию. Это может занять несколько секунд.
            </p>
          </div>
        </div>
      )}
      <div className="w-full max-w-6xl flex flex-col lg:flex-row lg:items-start gap-10">

        {/* Левая колонка — описание + видео */}
        <div className="flex-1 space-y-6 order-2 lg:order-1">
          <div>
            <h1 className="text-4xl font-black uppercase text-gradient mb-4">tactik.kz</h1>
            <p className="text-white/70 text-lg leading-relaxed">
              Инструмент для тренеров — разбираете игровые моменты прямо на видео вместе с командой.
              Открываете YouTube, рисуете схемы, объясняете позиции. Все участники видят одно и то же в реальном времени.
            </p>
          </div>

          <div className="relative w-full rounded-2xl overflow-hidden border border-white/10" style={{ paddingTop: '56.25%' }}>
            <iframe
              src={`https://www.youtube.com/embed/${PROMO_VIDEO_ID}?rel=0&modestbranding=1`}
              title="Как работает tactik.kz"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 w-full h-full"
            />
          </div>
        </div>

        {/* Правая колонка — форма */}
        <div className="w-full lg:w-[420px] lg:shrink-0 space-y-4 order-1 lg:order-2">

        {reason === 'inactivity' && (
          <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-xl px-5 py-4 text-sm text-yellow-300">
            Вы были автоматически выведены из системы после 2 часов неактивности.
          </div>
        )}
        {reason === 'demo_expired' && (
          <div className="bg-yellow-500/10 border border-yellow-500/40 rounded-xl px-5 py-4 text-sm text-yellow-300">
            Время тестового режима истекло.
          </div>
        )}

        <button
          type="button"
          onClick={handleDemo}
          disabled={isDemoLoading}
          className="w-full py-4 rounded-2xl font-black uppercase tracking-wide text-base bg-ucl-gold text-ucl-navy hover:bg-ucl-gold-light transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
        >
          {isDemoLoading ? 'Создание демо...' : 'Попробовать 5 минут — без регистрации'}
        </button>

        <div className="flex items-center gap-3">
          <div className="flex-1 h-px bg-white/15" />
          <span className="text-xs text-white/40 uppercase tracking-wide">или войдите</span>
          <div className="flex-1 h-px bg-white/15" />
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-xl">
          <h2 className="text-2xl font-black uppercase text-center mb-6">Вход</h2>

          {error && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-5">
              <p className="text-red-400 text-sm">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login" className="block text-sm font-bold text-white/80 mb-2 uppercase tracking-wide">
                Логин
              </label>
              <input
                id="login"
                type="text"
                className="input-field"
                placeholder="Введите логин"
                value={formData.login}
                onChange={(e) => setFormData({ ...formData, login: e.target.value })}
                required
                autoComplete="username"
                disabled={isLoading}
              />
            </div>
            <div>
              <label htmlFor="password" className="block text-sm font-bold text-white/80 mb-2 uppercase tracking-wide">
                Пароль
              </label>
              <input
                id="password"
                type="password"
                className="input-field"
                placeholder="Введите пароль"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                autoComplete="current-password"
                disabled={isLoading}
              />
            </div>
            <button
              type="submit"
              className="w-full btn-primary py-4 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isLoading}
            >
              {isLoading ? 'Вход...' : 'Войти'}
            </button>
          </form>
        </div>
        </div>{/* /правая колонка */}
      </div>{/* /две колонки */}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-ucl-navy" />}>
      <LoginPageContent />
    </Suspense>
  );
}
