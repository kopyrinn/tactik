'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi, type AdminErrorLogsPayload } from '@/lib/api';
import { useAdminStore } from '@/lib/stores/adminStore';

const EMPTY_LOGS: AdminErrorLogsPayload = {
  generatedAt: new Date(0).toISOString(),
  summary: {
    totalStored: 0,
    windowMinutes: 60,
    inWindowCount: 0,
    bySource: [],
  },
  entries: [],
};

export default function AdminLogsPage() {
  const router = useRouter();
  const { initAdmin } = useAdminStore();

  const [logsPayload, setLogsPayload] = useState<AdminErrorLogsPayload>(EMPTY_LOGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    void initAdmin();
  }, [initAdmin]);

  const loadLogs = useCallback(async () => {
    try {
      const response = await adminApi.getErrorLogs(300, 60);
      if (response.success && response.data) {
        setLogsPayload(response.data);
        setError(null);
      } else {
        setError(response.error || 'Ошибка загрузки логов');
      }
    } catch (e: any) {
      if (e.response?.status === 401) {
        router.push('/admin/login');
      } else {
        setError('Ошибка загрузки логов');
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void loadLogs();
  }, [loadLogs]);

  useEffect(() => {
    const timer = setInterval(() => {
      void loadLogs();
    }, 5000);

    return () => clearInterval(timer);
  }, [loadLogs]);

  const handleClearLogs = useCallback(async () => {
    const confirmed = window.confirm('Очистить буфер ошибок сервера?');
    if (!confirmed) return;

    setClearing(true);
    try {
      const response = await adminApi.clearErrorLogs();
      if (!response.success) {
        setError(response.error || 'Ошибка очистки логов');
        return;
      }
      await loadLogs();
    } catch (e: any) {
      if (e.response?.status === 401) {
        router.push('/admin/login');
      } else {
        setError('Ошибка очистки логов');
      }
    } finally {
      setClearing(false);
    }
  }, [loadLogs, router]);

  const updatedAtLabel = useMemo(() => {
    const parsed = new Date(logsPayload.generatedAt);
    if (Number.isNaN(parsed.getTime())) return '—';
    return parsed.toLocaleTimeString('ru-RU');
  }, [logsPayload.generatedAt]);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-wide">Логи Ошибок</h1>
          <p className="text-white/30 text-xs mt-0.5">Live журнал ошибок сервера</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { void handleClearLogs(); }}
            disabled={clearing}
            className="px-4 py-2 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-black uppercase tracking-wide hover:bg-red-500/30 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {clearing ? 'Очистка...' : 'Очистить логи'}
          </button>
          <div className="text-right">
            <p className="text-white/40 text-xs uppercase tracking-wide">Обновлено</p>
            <p className="text-sm font-bold text-white">{updatedAtLabel}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Всего в буфере</p>
          <p className="text-2xl font-black text-white">{logsPayload.summary.totalStored}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">За {logsPayload.summary.windowMinutes} мин</p>
          <p className="text-2xl font-black text-red-300">{logsPayload.summary.inWindowCount}</p>
        </div>
        <div className="bg-white/5 border border-white/10 rounded-xl px-4 py-3 col-span-2">
          <p className="text-white/40 text-xs uppercase tracking-wide mb-1">Топ источники</p>
          <p className="text-sm text-white/80">
            {logsPayload.summary.bySource.length === 0
              ? 'Нет ошибок'
              : logsPayload.summary.bySource.slice(0, 4).map((item) => `${item.source}: ${item.count}`).join(' · ')}
          </p>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-4 mb-6 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="bg-white/5 border border-white/10 rounded-xl overflow-auto">
        <div className="px-4 py-3 border-b border-white/10">
          <h2 className="text-sm font-black uppercase tracking-wide">Последние ошибки</h2>
        </div>
        {loading ? (
          <div className="px-4 py-10 text-center text-white/40">Загрузка...</div>
        ) : logsPayload.entries.length === 0 ? (
          <div className="px-4 py-10 text-center text-white/40">Ошибок не найдено</div>
        ) : (
          <table className="w-full min-w-[1180px]">
            <thead>
              <tr className="border-b border-white/10 text-[11px] font-bold uppercase tracking-wide text-white/40">
                <th className="text-left px-4 py-3">Время</th>
                <th className="text-left px-4 py-3">Источник</th>
                <th className="text-left px-4 py-3">Сообщение</th>
                <th className="text-left px-4 py-3">Детали</th>
              </tr>
            </thead>
            <tbody>
              {logsPayload.entries.map((entry) => (
                <tr key={entry.id} className="border-b border-white/5 last:border-0 align-top hover:bg-white/[0.03]">
                  <td className="px-4 py-3 text-xs text-white/60 whitespace-nowrap">
                    {new Date(entry.timestamp).toLocaleString('ru-RU')}
                  </td>
                  <td className="px-4 py-3 text-xs text-yellow-300 font-mono">{entry.source}</td>
                  <td className="px-4 py-3 text-sm text-red-300">{entry.message}</td>
                  <td className="px-4 py-3 text-xs text-white/50 font-mono">
                    {entry.details || entry.stack || '—'}
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
