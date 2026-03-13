'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { adminApi, type AdminUserSessionsStats } from '@/lib/api';
import { useAdminStore } from '@/lib/stores/adminStore';

function formatSeconds(totalSeconds: number | null) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return '—';
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatVideoTime(totalSeconds: number | null) {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return '—';
  const safeSeconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

const EMPTY_STATS: AdminUserSessionsStats = {
  generatedAt: new Date(0).toISOString(),
  user: {
    id: '',
    email: '',
    name: null,
    plan: 'free',
    createdAt: new Date(0).toISOString(),
  },
  summary: {
    ownerActiveDevices: 0,
    totalSessions: 0,
    activeSessions: 0,
    demoSessions: 0,
    storedDrawings: 0,
    liveSessions: 0,
    liveParticipantsTotal: 0,
    liveParticipantsAuthenticated: 0,
    liveParticipantsGuests: 0,
  },
  recentSessions: [],
  last7Days: [],
};

export default function AdminUserSessionStatsPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const userId = params?.id || '';
  const { initAdmin } = useAdminStore();

  const [stats, setStats] = useState<AdminUserSessionsStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void initAdmin();
  }, [initAdmin]);

  const loadStats = useCallback(async () => {
    if (!userId) return;

    try {
      const response = await adminApi.getUserSessionsStats(userId, 180);
      if (response.success && response.data) {
        setStats(response.data);
        setError(null);
      } else {
        setError(response.error || 'Ошибка загрузки статистики профиля');
      }
    } catch (e: any) {
      if (e.response?.status === 401) {
        router.push('/admin/login');
      } else {
        setError(e.response?.data?.error || 'Ошибка загрузки статистики профиля');
      }
    } finally {
      setLoading(false);
    }
  }, [router, userId]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadStats();
    }, 7000);

    return () => clearInterval(timer);
  }, [loadStats]);

  const updatedAtLabel = useMemo(() => {
    const parsed = new Date(stats.generatedAt);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleTimeString('ru-RU');
  }, [stats.generatedAt]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-wide">Профиль: статистика сессий</h1>
          <p className="text-white/30 text-xs mt-0.5">{stats.user.email || userId}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/users"
            className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-wide transition-colors"
          >
            Назад
          </Link>
          <div className="text-right">
            <p className="text-white/40 text-xs uppercase tracking-wide">Обновлено</p>
            <p className="text-sm font-bold text-white">{updatedAtLabel}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Устройства</p>
          <p className="text-2xl font-black text-cyan-300">{stats.summary.ownerActiveDevices}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Сессий всего</p>
          <p className="text-2xl font-black text-white">{stats.summary.totalSessions}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Активных</p>
          <p className="text-2xl font-black text-blue-400">{stats.summary.activeSessions}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Demo</p>
          <p className="text-2xl font-black text-yellow-300">{stats.summary.demoSessions}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Рисунков</p>
          <p className="text-2xl font-black text-white">{stats.summary.storedDrawings}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Live сессии</p>
          <p className="text-2xl font-black text-[#15c7a8]">{stats.summary.liveSessions}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Live участники</p>
          <p className="text-2xl font-black text-white">{stats.summary.liveParticipantsTotal}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Live гости</p>
          <p className="text-2xl font-black text-yellow-300">{stats.summary.liveParticipantsGuests}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-4 mb-6 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-auto mb-6">
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-black uppercase tracking-wide">Сессии профиля</h2>
        </div>
        {loading ? (
          <div className="px-4 py-10 text-center text-white/40">Загрузка...</div>
        ) : stats.recentSessions.length === 0 ? (
          <div className="px-4 py-10 text-center text-white/40">У профиля пока нет сессий</div>
        ) : (
          <table className="w-full min-w-[1080px]">
            <thead>
              <tr className="border-b border-white/10 text-[11px] font-bold uppercase tracking-wide text-white/40">
                <th className="text-left px-4 py-3">Сессия</th>
                <th className="text-center px-3 py-3">Статус</th>
                <th className="text-center px-3 py-3">Участники</th>
                <th className="text-center px-3 py-3">Гости</th>
                <th className="text-center px-3 py-3">Рисунки</th>
                <th className="text-center px-3 py-3">Видео</th>
                <th className="text-center px-3 py-3">Демо таймер</th>
                <th className="text-left px-4 py-3">Обновлена</th>
              </tr>
            </thead>
            <tbody>
              {stats.recentSessions.map((session) => (
                <tr key={session.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <p className="text-sm font-bold text-white">{session.name || 'Без названия'}</p>
                    <p className="text-xs text-white/35 font-mono">{session.id}</p>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-xs font-black uppercase ${session.isActive ? 'text-[#15c7a8]' : 'text-white/35'}`}>
                      {session.isDemo ? 'demo' : 'pro'} · {session.isActive ? 'active' : 'closed'}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center text-white font-black">{session.live.participantsTotal}</td>
                  <td className="px-3 py-3 text-center text-yellow-300 font-black">{session.live.participantsGuests}</td>
                  <td className="px-3 py-3 text-center text-white font-black">{session.storedDrawings}</td>
                  <td className="px-3 py-3 text-center">
                    <p className="text-sm text-white font-mono">{formatVideoTime(session.live.currentVideoTime)}</p>
                    <p className={`text-[11px] font-bold uppercase ${session.live.isPlaying ? 'text-green-400' : 'text-white/35'}`}>
                      {session.live.isPlaying ? 'play' : 'pause'}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-sm font-black ${session.secondsLeft != null && session.secondsLeft <= 60 ? 'text-red-400' : 'text-yellow-300'}`}>
                      {session.isDemo ? formatSeconds(session.secondsLeft) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-white/35">{new Date(session.updatedAt).toLocaleString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-auto">
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-black uppercase tracking-wide">Создание сессий за 7 дней</h2>
        </div>
        <table className="w-full min-w-[520px]">
          <thead>
            <tr className="border-b border-white/10 text-[11px] font-bold uppercase tracking-wide text-white/40">
              <th className="text-left px-4 py-3">День</th>
              <th className="text-center px-3 py-3">Сессии</th>
            </tr>
          </thead>
          <tbody>
            {stats.last7Days.map((day) => (
              <tr key={day.day} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-sm text-white">{day.day}</td>
                <td className="px-3 py-3 text-center text-sm font-black text-blue-400">{day.sessionsCreated}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
