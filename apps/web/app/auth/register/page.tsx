'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';

function RegisterPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { register, isLoading, error, clearError } = useAuthStore();
  const redirectTo = searchParams.get('redirect');

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  const [formError, setFormError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    setFormError('');

    if (!formData.email || !formData.password) {
      setFormError('Email and password are required');
      return;
    }

    if (formData.password.length < 8) {
      setFormError('Password must be at least 8 characters');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setFormError('Passwords do not match');
      return;
    }

    try {
      await register(formData.email, formData.password, formData.name || undefined);
      if (redirectTo && redirectTo.startsWith('/')) {
        router.push(redirectTo);
      } else {
        router.push('/dashboard');
      }
    } catch {
      // Error is handled in store
    }
  };

  const displayError = formError || error;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <Link href="/" className="block text-center mb-8">
          <h1 className="text-4xl font-black uppercase text-gradient">
            tactik.kz
          </h1>
        </Link>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-xl">
          <h2 className="text-3xl font-black uppercase text-center mb-2">
            Create Account
          </h2>
          <p className="text-white/60 text-center mb-8">
            Start your free 3-minute session
          </p>

          {displayError && (
            <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-6">
              <p className="text-red-400 text-sm">{displayError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="name" className="block text-sm font-bold text-white/80 mb-2 uppercase tracking-wide">
                Name (Optional)
              </label>
              <input
                id="name"
                type="text"
                className="input-field"
                placeholder="Your name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-bold text-white/80 mb-2 uppercase tracking-wide">
                Email *
              </label>
              <input
                id="email"
                type="email"
                className="input-field"
                placeholder="your@email.com"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-bold text-white/80 mb-2 uppercase tracking-wide">
                Password *
              </label>
              <input
                id="password"
                type="password"
                className="input-field"
                placeholder="Minimum 8 characters"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                required
                disabled={isLoading}
                minLength={8}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-bold text-white/80 mb-2 uppercase tracking-wide">
                Confirm Password *
              </label>
              <input
                id="confirmPassword"
                type="password"
                className="input-field"
                placeholder="Re-enter password"
                value={formData.confirmPassword}
                onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                required
                disabled={isLoading}
              />
            </div>

            <button
              type="submit"
              className="w-full btn-primary py-4 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={isLoading}
            >
              {isLoading ? 'Creating Account...' : 'Create Account'}
            </button>
          </form>

          <p className="text-center mt-6 text-white/60 text-sm">
            Already have an account?{' '}
            <Link
              href={redirectTo ? `/auth/login?redirect=${encodeURIComponent(redirectTo)}` : '/auth/login'}
              className="text-premier-cyan font-bold hover:underline"
            >
              Sign In
            </Link>
          </p>
        </div>

        <p className="text-center mt-6 text-white/40 text-xs">
          By creating an account, you agree to our{' '}
          <Link href="/terms" className="text-white/60 hover:text-white">Terms</Link>
          {' '}and{' '}
          <Link href="/privacy" className="text-white/60 hover:text-white">Privacy Policy</Link>
        </p>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-ucl-navy" />}>
      <RegisterPageContent />
    </Suspense>
  );
}
