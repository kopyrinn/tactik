'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi, type AdminDemoOverview } from '@/lib/api';
import { useAdminStore } from '@/lib/stores/adminStore';

function formatSeconds(totalSeconds: number) {
  const safeSeconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
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

function formatDay(day: string) {
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return parsed.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
}

const EMPTY_OVERVIEW: AdminDemoOverview = {
  generatedAt: new Date(0).toISOString(),
  live: {
    activeDemoUsers: 0,
    activeDemoSessions: 0,
    listedDemoSessions: 0,
    liveSessionLimit: 200,
    activeDemoParticipants: 0,
    sessions: [],
  },
  totals: {
    starts: 0,
    sessionsCreated: 0,
    participantJoins: 0,
  },
  today: {
    day: '1970-01-01',
    starts: 0,
    sessionsCreated: 0,
    participantJoins: 0,
  },
  last7Days: [],
};

export default function AdminDemoPage() {
  const router = useRouter();
  const { initAdmin } = useAdminStore();

  const [overview, setOverview] = useState<AdminDemoOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  useEffect(() => {
    void initAdmin();
  }, [initAdmin]);

  const loadOverview = useCallback(async () => {
    try {
      const response = await adminApi.getDemoOverview();
      if (response.success && response.data) {
        setOverview(response.data);
        setError(null);
      } else {
        setError(response.error || 'Ошибка загрузки demo-статистики');
      }
    } catch (e: any) {
      if (e.response?.status === 401) {
        router.push('/admin/login');
      } else {
        setError('Ошибка загрузки demo-статистики');
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadOverview();
    }, 5000);

    return () => clearInterval(timer);
  }, [loadOverview]);

  const updatedAtLabel = useMemo(() => {
    const parsed = new Date(overview.generatedAt);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleTimeString('ru-RU');
  }, [overview.generatedAt]);

  const handleResetMetrics = useCallback(async () => {
    const confirmed = window.confirm('Обнулить demo-счетчики в мониторинге?');
    if (!confirmed) return;

    setResetLoading(true);
    try {
      const response = await adminApi.resetDemoMetrics('all');
      if (!response.success) {
        setError(response.error || 'Ошибка сброса demo-счетчиков');
        return;
      }
      await loadOverview();
    } catch (e: any) {
      if (e.response?.status === 401) {
        router.push('/admin/login');
      } else {
        setError('Ошибка сброса demo-счетчиков');
      }
    } finally {
      setResetLoading(false);
    }
  }, [loadOverview, router]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-wide">Demo Мониторинг</h1>
          <p className="text-white/30 text-xs mt-0.5">Live обновление каждые 5 сек</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { void handleResetMetrics(); }}
            disabled={resetLoading}
            className="px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-black uppercase tracking-wide hover:bg-red-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {resetLoading ? 'Сброс...' : 'Обнулить счетчики'}
          </button>
          <div className="text-right">
            <p className="text-white/40 text-xs uppercase tracking-wide">Обновлено</p>
            <p className="text-sm font-bold text-white">{updatedAtLabel}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Demo юзеры онлайн</p>
          <p className="text-3xl font-black text-[#15c7a8]">{overview.live.activeDemoUsers}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Demo сессии сейчас</p>
          <p className="text-3xl font-black text-blue-400">{overview.live.activeDemoSessions}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Участники онлайн</p>
          <p className="text-3xl font-black text-yellow-300">{overview.live.activeDemoParticipants}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Запусков сегодня</p>
          <p className="text-3xl font-black text-white">{overview.today.starts}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Всего запусков demo</p>
          <p className="text-2xl font-black text-white">{overview.totals.starts}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Всего создано demo-сессий</p>
          <p className="text-2xl font-black text-white">{overview.totals.sessionsCreated}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Всего входов в demo</p>
          <p className="text-2xl font-black text-white">{overview.totals.participantJoins}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-4 mb-6 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-auto mb-6">
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-black uppercase tracking-wide">Live demo-сессии</h2>
          {overview.live.activeDemoSessions > overview.live.listedDemoSessions && (
            <p className="text-xs text-white/35 mt-1">
              Показаны {overview.live.listedDemoSessions} из {overview.live.activeDemoSessions} (лимит {overview.live.liveSessionLimit})
            </p>
          )}
        </div>
        {loading ? (
          <div className="px-4 py-10 text-center text-white/40">Загрузка...</div>
        ) : overview.live.sessions.length === 0 ? (
          <div className="px-4 py-10 text-center text-white/40">Активных demo-сессий сейчас нет</div>
        ) : (
          <table className="w-full min-w-[980px]">
            <thead>
              <tr className="border-b border-white/10 text-[11px] font-bold uppercase tracking-wide text-white/40">
                <th className="text-left px-4 py-3">Сессия</th>
                <th className="text-left px-4 py-3">Владелец</th>
                <th className="text-center px-3 py-3">Участники</th>
                <th className="text-center px-3 py-3">Осталось</th>
                <th className="text-center px-3 py-3">Видео</th>
                <th className="text-left px-4 py-3">Создана</th>
              </tr>
            </thead>
            <tbody>
              {overview.live.sessions.map((session) => (
                <tr key={session.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <p className="text-sm font-bold text-white">{session.name || 'Без названия'}</p>
                    <p className="text-xs text-white/35 font-mono">{session.id}</p>
                  </td>
                  <td className="px-4 py-3 text-sm text-white/75">{session.ownerEmail || '—'}</td>
                  <td className="px-3 py-3 text-center">
                    <span className="text-sm font-black text-[#15c7a8]">{session.onlineParticipants}</span>
                    <span className="text-xs text-white/40"> / {session.maxParticipants}</span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-sm font-black ${session.secondsLeft <= 60 ? 'text-red-400' : 'text-yellow-300'}`}>
                      {formatSeconds(session.secondsLeft)}
                    </span>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <p className="text-sm text-white font-mono">{formatVideoTime(session.currentVideoTime)}</p>
                    <p className={`text-[11px] font-bold uppercase ${session.isPlaying ? 'text-green-400' : 'text-white/35'}`}>
                      {session.isPlaying ? 'play' : 'pause'}
                    </p>
                  </td>
                  <td className="px-4 py-3 text-xs text-white/35">{new Date(session.createdAt).toLocaleString('ru-RU')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-auto">
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-black uppercase tracking-wide">Demo динамика за 7 дней</h2>
        </div>
        <table className="w-full min-w-[720px]">
          <thead>
            <tr className="border-b border-white/10 text-[11px] font-bold uppercase tracking-wide text-white/40">
              <th className="text-left px-4 py-3">День</th>
              <th className="text-center px-3 py-3">Запуски</th>
              <th className="text-center px-3 py-3">Сессии</th>
              <th className="text-center px-3 py-3">Входы</th>
            </tr>
          </thead>
          <tbody>
            {overview.last7Days.map((day) => (
              <tr key={day.day} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 text-sm text-white">{formatDay(day.day)}</td>
                <td className="px-3 py-3 text-center text-sm font-black text-[#15c7a8]">{day.starts}</td>
                <td className="px-3 py-3 text-center text-sm font-black text-blue-400">{day.sessionsCreated}</td>
                <td className="px-3 py-3 text-center text-sm font-black text-yellow-300">{day.participantJoins}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
