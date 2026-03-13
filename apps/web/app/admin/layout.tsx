'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAdminStore } from '@/lib/stores/adminStore';

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isAdminAuthenticated, isAdminReady, adminLogout, initAdmin } = useAdminStore();

  useEffect(() => {
    void initAdmin();
  }, [initAdmin]);

  const isLoginPage = pathname === '/admin/login';
  const isUsersPage = pathname?.startsWith('/admin/users');
  const isSessionsPage = pathname?.startsWith('/admin/sessions');
  const isDemoPage = pathname?.startsWith('/admin/demo');
  const isLogsPage = pathname?.startsWith('/admin/logs');

  useEffect(() => {
    if (!isLoginPage && isAdminReady && !isAdminAuthenticated) {
      router.push('/admin/login');
    }
  }, [isAdminAuthenticated, isAdminReady, isLoginPage, router]);

  const handleLogout = async () => {
    await adminLogout();
    router.push('/admin/login');
  };

  return (
    <div className="min-h-screen bg-[#070d16]">
      <nav className="fixed top-0 left-0 right-0 h-[60px] bg-black/95 backdrop-blur-xl border-b border-white/10 z-50">
        <div className="max-w-6xl mx-auto px-6 h-full flex items-center justify-between">
          <span className="text-xl font-black uppercase tracking-widest text-white">
            tactik.kz <span className="text-[#15c7a8]">ADMIN</span>
          </span>
          {!isLoginPage && (
            <div className="flex items-center gap-2">
              <Link
                href="/admin/users"
                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${
                  isUsersPage ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white hover:bg-white/10'
                }`}
              >
                Пользователи
              </Link>
              <Link
                href="/admin/demo"
                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${
                  isDemoPage ? 'bg-[#15c7a8]/25 text-[#15c7a8]' : 'text-white/55 hover:text-white hover:bg-white/10'
                }`}
              >
                Demo
              </Link>
              <Link
                href="/admin/sessions"
                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${
                  isSessionsPage ? 'bg-blue-500/25 text-blue-300' : 'text-white/55 hover:text-white hover:bg-white/10'
                }`}
              >
                Сессии
              </Link>
              <Link
                href="/admin/logs"
                className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-colors ${
                  isLogsPage ? 'bg-red-500/25 text-red-300' : 'text-white/55 hover:text-white hover:bg-white/10'
                }`}
              >
                Логи
              </Link>
              <button
                onClick={handleLogout}
                className="ml-2 text-sm font-bold text-white/60 hover:text-white uppercase tracking-wide transition-colors"
              >
                Выйти
              </button>
            </div>
          )}
        </div>
      </nav>
      <main className="pt-[60px]">{children}</main>
    </div>
  );
}
