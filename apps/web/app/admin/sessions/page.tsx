'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi, type AdminSessionsOverview } from '@/lib/api';
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

const EMPTY_OVERVIEW: AdminSessionsOverview = {
  generatedAt: new Date(0).toISOString(),
  summary: {
    totalActiveSessions: 0,
    listedSessions: 0,
    sessionsWithParticipants: 0,
    participantsOnline: 0,
    guestParticipantsOnline: 0,
    authenticatedParticipantsOnline: 0,
    activeOwnerDevices: 0,
  },
  owners: [],
  sessions: [],
  meta: {
    limit: 300,
    total: 0,
    truncated: false,
  },
};

export default function AdminSessionsPage() {
  const router = useRouter();
  const { initAdmin } = useAdminStore();

  const [overview, setOverview] = useState<AdminSessionsOverview>(EMPTY_OVERVIEW);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void initAdmin();
  }, [initAdmin]);

  const loadOverview = useCallback(async () => {
    try {
      const response = await adminApi.getSessionsOverview(500);
      if (response.success && response.data) {
        setOverview(response.data);
        setError(null);
      } else {
        setError(response.error || 'Ошибка загрузки статистики сессий');
      }
    } catch (e: any) {
      if (e.response?.status === 401) {
        router.push('/admin/login');
      } else {
        setError('Ошибка загрузки статистики сессий');
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

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-wide">Сессии Онлайн</h1>
          <p className="text-white/30 text-xs mt-0.5">Обновление каждые 5 сек</p>
        </div>
        <div className="text-right">
          <p className="text-white/40 text-xs uppercase tracking-wide">Обновлено</p>
          <p className="text-sm font-bold text-white">{updatedAtLabel}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-6">
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Активных сессий</p>
          <p className="text-2xl font-black text-blue-400">{overview.summary.totalActiveSessions}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Сессий с людьми</p>
          <p className="text-2xl font-black text-[#15c7a8]">{overview.summary.sessionsWithParticipants}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Людей в сессиях</p>
          <p className="text-2xl font-black text-white">{overview.summary.participantsOnline}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Гостей</p>
          <p className="text-2xl font-black text-yellow-300">{overview.summary.guestParticipantsOnline}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">С логином</p>
          <p className="text-2xl font-black text-green-400">{overview.summary.authenticatedParticipantsOnline}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Устр. владельцев</p>
          <p className="text-2xl font-black text-cyan-300">{overview.summary.activeOwnerDevices}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Владельцев</p>
          <p className="text-2xl font-black text-white">{overview.owners.length}</p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-4 mb-6 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-auto mb-6">
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-black uppercase tracking-wide">Группы по владельцам</h2>
        </div>
        {loading ? (
          <div className="px-4 py-8 text-center text-white/40">Загрузка...</div>
        ) : overview.owners.length === 0 ? (
          <div className="px-4 py-8 text-center text-white/40">Нет активных владельцев сессий</div>
        ) : (
          <table className="w-full min-w-[900px]">
            <thead>
              <tr className="border-b border-white/10 text-[11px] font-bold uppercase tracking-wide text-white/40">
                <th className="text-left px-4 py-3">Владелец</th>
                <th className="text-center px-3 py-3">Устройства</th>
                <th className="text-center px-3 py-3">Сессии</th>
                <th className="text-center px-3 py-3">Живые</th>
                <th className="text-center px-3 py-3">Люди</th>
                <th className="text-center px-3 py-3">Гости</th>
                <th className="text-center px-3 py-3">С логином</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {overview.owners.map((owner) => (
                <tr key={owner.ownerId} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3">
                    <p className="text-sm font-bold text-white">{owner.ownerEmail || owner.ownerId}</p>
                    <p className="text-xs text-white/35">{owner.ownerName || '—'}</p>
                  </td>
                  <td className="px-3 py-3 text-center text-cyan-300 font-black">{owner.ownerActiveDevices}</td>
                  <td className="px-3 py-3 text-center text-white font-black">{owner.sessionsTotal}</td>
                  <td className="px-3 py-3 text-center text-[#15c7a8] font-black">{owner.sessionsLive}</td>
                  <td className="px-3 py-3 text-center text-white font-black">{owner.participantsTotal}</td>
                  <td className="px-3 py-3 text-center text-yellow-300 font-black">{owner.participantsGuests}</td>
                  <td className="px-3 py-3 text-center text-green-400 font-black">{owner.participantsAuthenticated}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/users/${owner.ownerId}/stats`}
                      className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-wide transition-colors"
                    >
                      Профиль
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-auto">
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-black uppercase tracking-wide">Сессии в моменте</h2>
          {overview.meta.truncated && (
            <p className="text-xs text-white/35 mt-1">
              Показаны {overview.sessions.length} из {overview.meta.total} активных сессий.
            </p>
          )}
        </div>
        {loading ? (
          <div className="px-4 py-10 text-center text-white/40">Загрузка...</div>
        ) : overview.sessions.length === 0 ? (
          <div className="px-4 py-10 text-center text-white/40">Активных сессий нет</div>
        ) : (
          <table className="w-full min-w-[1180px]">
            <thead>
              <tr className="border-b border-white/10 text-[11px] font-bold uppercase tracking-wide text-white/40">
                <th className="text-left px-4 py-3">Сессия</th>
                <th className="text-left px-4 py-3">Владелец</th>
                <th className="text-center px-3 py-3">Устр.</th>
                <th className="text-center px-3 py-3">Участники</th>
                <th className="text-center px-3 py-3">Гости</th>
                <th className="text-center px-3 py-3">С логином</th>
                <th className="text-center px-3 py-3">Видео</th>
                <th className="text-center px-3 py-3">Демо таймер</th>
                <th className="text-left px-4 py-3">Создана</th>
              </tr>
            </thead>
            <tbody>
              {overview.sessions.map((session) => (
                <tr key={session.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]">
                  <td className="px-4 py-3">
                    <p className="text-sm font-bold text-white">{session.name || 'Без названия'}</p>
                    <p className="text-xs text-white/35 font-mono">{session.id}</p>
                    <p className="text-[11px] text-white/30 mt-1">
                      {session.isDemo ? 'DEMO' : 'Обычная'} · max {session.maxParticipants}
                    </p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-sm text-white">{session.ownerEmail || session.ownerId}</p>
                    <p className="text-xs text-white/35">{session.ownerName || '—'}</p>
                  </td>
                  <td className="px-3 py-3 text-center text-cyan-300 font-black">{session.ownerActiveDevices}</td>
                  <td className="px-3 py-3 text-center text-white font-black">{session.participants.total}</td>
                  <td className="px-3 py-3 text-center text-yellow-300 font-black">{session.participants.guests}</td>
                  <td className="px-3 py-3 text-center text-green-400 font-black">{session.participants.authenticated}</td>
                  <td className="px-3 py-3 text-center">
                    <p className="text-sm text-white font-mono">{formatVideoTime(session.currentVideoTime)}</p>
                    <p className={`text-[11px] font-bold uppercase ${session.isPlaying ? 'text-green-400' : 'text-white/35'}`}>
                      {session.isPlaying ? 'play' : 'pause'}
                    </p>
                  </td>
                  <td className="px-3 py-3 text-center">
                    <span className={`text-sm font-black ${session.secondsLeft != null && session.secondsLeft <= 60 ? 'text-red-400' : 'text-yellow-300'}`}>
                      {session.isDemo ? formatSeconds(session.secondsLeft) : '—'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-white/35">
                    {new Date(session.createdAt).toLocaleString('ru-RU')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
