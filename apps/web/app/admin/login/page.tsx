'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminStore } from '@/lib/stores/adminStore';

export default function AdminLoginPage() {
  const router = useRouter();
  const { adminLogin, isAdminLoading, adminError, clearAdminError, initAdmin, isAdminAuthenticated, isAdminReady } = useAdminStore();

  const [formData, setFormData] = useState({ login: '', password: '' });

  useEffect(() => {
    void initAdmin();
  }, [initAdmin]);

  useEffect(() => {
    if (isAdminReady && isAdminAuthenticated) {
      router.push('/admin/users');
    }
  }, [isAdminAuthenticated, isAdminReady, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAdminError();
    try {
      await adminLogin(formData.login, formData.password);
      router.push('/admin/users');
    } catch {}
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-black uppercase tracking-widest text-white">
            tactik.kz <span className="text-[#15c7a8]">ADMIN</span>
          </h1>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8">
          <h2 className="text-xl font-black uppercase text-center mb-6">Вход</h2>

          {adminError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-3 mb-5">
              <p className="text-red-400 text-sm">{adminError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-white/60 mb-1.5 uppercase tracking-wide">
                Логин
              </label>
              <input
                type="text"
                className="input-field"
                value={formData.login}
                onChange={(e) => setFormData({ ...formData, login: e.target.value })}
                required
                autoComplete="username"
                disabled={isAdminLoading}
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-white/60 mb-1.5 uppercase tracking-wide">
                Пароль
              </label>
              <input
                type="password"
                className="input-field"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                autoComplete="current-password"
                disabled={isAdminLoading}
              />
            </div>
            <button
              type="submit"
              className="w-full btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed mt-2"
              disabled={isAdminLoading}
            >
              {isAdminLoading ? 'Вход...' : 'Войти'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
