'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import { useUiStore } from '@/lib/stores/uiStore';
import { t } from '@/lib/i18n';
import { useInactivityLogout } from '@/lib/hooks/useInactivityLogout';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { user, logout, checkAuth, isLoading } = useAuthStore();
  const { language, setLanguage } = useUiStore();

  useInactivityLogout();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    if (!isLoading && !user) {
      router.push('/auth/login');
    }
  }, [user, isLoading, router]);

  const handleLogout = async () => {
    await logout();
    router.push('/');
  };

  if (isLoading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-ucl-gold border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-white/60">{t(language, 'loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 h-[70px] bg-ucl-navy/95 backdrop-blur-xl border-b border-ucl-blue/40 z-50">
        <div className="max-w-7xl mx-auto px-6 h-full flex items-center justify-between">
          <Link href="/dashboard" className="text-2xl font-black uppercase text-gradient">
            tactik.kz
          </Link>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1 border border-white/10">
              <span className="hidden sm:block text-xs text-white/50 px-2">{t(language, 'language')}</span>
              <button
                onClick={() => setLanguage('ru')}
                className={`px-2 py-1 rounded text-xs font-bold ${language === 'ru' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'}`}
              >
                RU
              </button>
              <button
                onClick={() => setLanguage('kk')}
                className={`px-2 py-1 rounded text-xs font-bold ${language === 'kk' ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white'}`}
              >
                KZ
              </button>
            </div>

            {/* User Plan Badge */}
            <div className="hidden sm:block">
              <span className={`
                px-3 py-1 rounded-full text-xs font-black uppercase tracking-wider
                ${user.plan === 'pro' ? 'bg-ucl-gold/20 text-ucl-gold' :
                  user.plan === 'coach' ? 'bg-ucl-light/20 text-ucl-light' :
                  'bg-white/10 text-white/60'}
              `}>
                {user.plan}
              </span>
            </div>

            {/* User Menu */}
            <div className="flex items-center gap-4">
              <div className="hidden sm:block text-right">
                <p className="text-sm font-bold text-white">{user.name || t(language, 'userFallback')}</p>
                <p className="text-xs text-white/40">{user.email}</p>
              </div>

              <button
                onClick={handleLogout}
                className="px-4 py-2 text-sm font-bold text-white/80 hover:text-white transition-colors uppercase tracking-wide"
              >
                {t(language, 'logout')}
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="pt-[70px]">
        {children}
      </main>
    </div>
  );
}
