'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/stores/authStore';
import { useUiStore } from '@/lib/stores/uiStore';
import { sessionsApi } from '@/lib/api';
import type { Session } from '@/lib/types';
import type { AppLanguage } from '@/lib/i18n';
import { t } from '@/lib/i18n';
import CreateSessionModal from '@/components/dashboard/CreateSessionModal';

const LAST_SESSION_STORAGE_KEY = 'tactik:last-session-id';

export default function DashboardPage() {
  const { user } = useAuthStore();
  const { language } = useUiStore();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);

  const loadSessions = async () => {
    try {
      setIsLoading(true);
      const response = await sessionsApi.list();
      if (response.success && response.data) {
        setSessions(response.data);
      }
    } catch (error) {
      console.error('Failed to load sessions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSessions();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setLastSessionId(window.localStorage.getItem(LAST_SESSION_STORAGE_KEY));
  }, []);

  const handleSessionCreated = () => {
    setShowCreateModal(false);
    loadSessions();
  };

  const handleDeleteSession = async (id: string) => {
    if (!confirm(t(language, 'deleteConfirm'))) {
      return;
    }

    try {
      await sessionsApi.delete(id);
      loadSessions();
    } catch (error) {
      console.error('Failed to delete session:', error);
    }
  };

  const handleSessionOpened = (id: string) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(LAST_SESSION_STORAGE_KEY, id);
    setLastSessionId(id);
  };

  const activeSessions = sessions.filter((s) => s.isActive);
  const inactiveSessions = sessions.filter((s) => !s.isActive);
  const lastSession = useMemo(
    () => (lastSessionId ? sessions.find((s) => s.id === lastSessionId) || null : null),
    [lastSessionId, sessions]
  );

  const planLabel =
    user?.plan === 'pro'
      ? t(language, 'planPro')
      : user?.plan === 'coach'
        ? t(language, 'planCoach')
        : t(language, 'planFree');
  const canCreateSessions = (user?.plan === 'coach' || user?.plan === 'pro') && !user?.coachOwnerId;

  return (
    <div className="min-h-screen p-6">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-4xl font-black uppercase mb-2">{t(language, 'yourSessions')}</h1>
            <p className="text-white/60">{t(language, 'manageSessions')}</p>
          </div>
          <Link href="/" className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold uppercase">
            {t(language, 'home')}
          </Link>
        </div>

        {lastSession && (
          <div className="mb-6 bg-ucl-gold/10 border border-ucl-gold/30 rounded-lg p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-white/70">{t(language, 'continueLastSession')}</p>
              <p className="font-black uppercase">{lastSession.name}</p>
            </div>
            <Link href={`/session/${lastSession.id}`} onClick={() => handleSessionOpened(lastSession.id)} className="btn-primary px-5 py-2">
              {t(language, 'open')}
            </Link>
          </div>
        )}

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div className="bg-white/5 border border-white/10 rounded-lg px-5 py-3">
            <p className="text-sm text-white/60 mb-1">{t(language, 'currentPlan')}</p>
            <p className="text-xl font-black uppercase">{planLabel}</p>
            <p className="text-xs text-white/40 mt-1">
              {user?.plan === 'free' && t(language, 'planLimitsFree')}
              {user?.plan === 'coach' && t(language, 'planLimitsCoach')}
              {user?.plan === 'pro' && t(language, 'planLimitsPro')}
            </p>
          </div>

          <button
            onClick={() => setShowCreateModal(true)}
            disabled={!canCreateSessions}
            title={!canCreateSessions ? 'Создание сессий доступно только мастеру' : undefined}
            className="btn-primary px-8 py-4 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            + {t(language, 'createNewSession')}
          </button>
        </div>

        {isLoading && (
          <div className="text-center py-20">
            <div className="w-16 h-16 border-4 border-ucl-gold border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
            <p className="text-white/60">{t(language, 'loadingSessions')}</p>
          </div>
        )}

        {!isLoading && sessions.length === 0 && (
          <div className="text-center py-20">
            <h2 className="text-2xl font-black uppercase mb-3">{t(language, 'noSessions')}</h2>
            <button
              onClick={() => setShowCreateModal(true)}
              disabled={!canCreateSessions}
              title={!canCreateSessions ? 'Создание сессий доступно только мастеру' : undefined}
              className="btn-primary px-8 py-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t(language, 'createFirstSession')}
            </button>
          </div>
        )}

        {!isLoading && activeSessions.length > 0 && (
          <div className="mb-12">
            <h2 className="text-2xl font-black uppercase mb-4">{t(language, 'activeSessions')}</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {activeSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  language={language}
                  onDelete={handleDeleteSession}
                  onOpen={handleSessionOpened}
                />
              ))}
            </div>
          </div>
        )}

        {!isLoading && inactiveSessions.length > 0 && (
          <div>
            <h2 className="text-2xl font-black uppercase mb-4 text-white/60">{t(language, 'pastSessions')}</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {inactiveSessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  language={language}
                  onDelete={handleDeleteSession}
                  onOpen={handleSessionOpened}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {showCreateModal && <CreateSessionModal onClose={() => setShowCreateModal(false)} onCreated={handleSessionCreated} />}
    </div>
  );
}

function SessionCard({
  session,
  language,
  onDelete,
  onOpen,
}: {
  session: Session;
  language: AppLanguage;
  onDelete: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const router = useRouter();
  const thumbnailUrl = `https://i.ytimg.com/vi/${session.youtubeVideoId}/mqdefault.jpg`;
  const locale = language === 'kk' ? 'kk-KZ' : 'ru-RU';
  const handleOpenSession = () => {
    onOpen(session.id);
    router.push(`/session/${session.id}`);
  };

  return (
    <div
      className="card group hover:-translate-y-2 cursor-pointer"
      role="button"
      tabIndex={0}
      onClick={handleOpenSession}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleOpenSession();
        }
      }}
    >
      <div className="relative aspect-video rounded-lg overflow-hidden mb-4">
        <img src={thumbnailUrl} alt={session.name} className="w-full h-full object-cover" />
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              handleOpenSession();
            }}
            className="bg-white text-ucl-navy px-6 py-2 rounded-lg font-bold hover:bg-ucl-gold transition-colors"
          >
            {t(language, 'openSession')}
          </button>
        </div>
      </div>

      <h3 className="text-lg font-black uppercase mb-2 truncate">{session.name}</h3>
      <p className="text-sm text-white/40 mb-4">
        {t(language, 'createdAt')} {new Date(session.createdAt).toLocaleDateString(locale)}
      </p>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            handleOpenSession();
          }}
          className="flex-1 text-center bg-ucl-gold text-ucl-navy px-4 py-2 rounded-lg text-sm font-bold uppercase hover:bg-ucl-gold-light transition-colors"
        >
          {t(language, 'open')}
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onDelete(session.id);
          }}
          className="px-4 py-2 rounded-lg text-sm font-bold uppercase bg-white/5 hover:bg-red-500/20 text-white/60 hover:text-red-400 transition-colors"
        >
          {t(language, 'delete')}
        </button>
      </div>
    </div>
  );
}
