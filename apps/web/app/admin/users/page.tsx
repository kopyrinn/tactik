'use client';

import Link from 'next/link';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAdminStore } from '@/lib/stores/adminStore';
import { adminApi, type AdminUser, type AdminUserInput } from '@/lib/api';

type UserForm = {
  login: string;
  name: string;
  password: string;
  plan: string;
  role_type: 'trainer' | 'assistant';
  coach_owner_id: string;
  copy_password_from_coach: boolean;
  max_devices_override: string;
  max_sessions_override: string;
  max_participants_override: string;
};

const EMPTY_FORM: UserForm = {
  login: '',
  name: '',
  password: '',
  plan: 'free',
  role_type: 'trainer',
  coach_owner_id: '',
  copy_password_from_coach: false,
  max_devices_override: '',
  max_sessions_override: '',
  max_participants_override: '',
};

const PLAN_DEFAULTS = {
  free: { devices: 2, sessions: 0, participants: 2 },
  coach: { devices: 6, sessions: 10, participants: 4 },
  pro: { devices: 10, sessions: 20, participants: 6 },
};

const PLAN_COLORS: Record<string, string> = {
  free: 'bg-white/10 text-white/50',
  coach: 'bg-pink-500/20 text-pink-300',
  pro: 'bg-[#15c7a8]/20 text-[#15c7a8]',
};

function planDefaults(plan: string) {
  return PLAN_DEFAULTS[plan as keyof typeof PLAN_DEFAULTS] ?? PLAN_DEFAULTS.free;
}

function OverrideCell({ val, def }: { val: number | null; def: number }) {
  if (val == null) {
    return (
      <span className="text-white/30 text-xs">
        {def}
        <span className="text-white/20 ml-0.5">(п)</span>
      </span>
    );
  }
  return <span className="text-[#15c7a8] text-xs font-bold">{val}</span>;
}

export default function AdminUsersPage() {
  const router = useRouter();
  const { initAdmin } = useAdminStore();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [form, setForm] = useState<UserForm>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<AdminUser | null>(null);

  useEffect(() => {
    void initAdmin();
  }, [initAdmin]);

  const loadUsers = useCallback(async () => {
    setError(null);
    try {
      const res = await adminApi.getUsers();
      if (res.success && res.data) {
        setUsers(res.data);
      } else {
        setError(res.error || 'Ошибка загрузки пользователей');
      }
    } catch (e: any) {
      if (e.response?.status === 401) {
        router.push('/admin/login');
      } else {
        setError('Ошибка загрузки пользователей');
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  useEffect(() => {
    const id = setInterval(loadUsers, 15000);
    return () => clearInterval(id);
  }, [loadUsers]);

  const openCreate = () => {
    setEditingUser(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setModalOpen(true);
  };

  const openEdit = (u: AdminUser) => {
    const isAssistant = Boolean(u.coach_owner_id);
    setEditingUser(u);
    setForm({
      login: u.email,
      name: u.name || '',
      password: '',
      plan: u.plan,
      role_type: isAssistant ? 'assistant' : 'trainer',
      coach_owner_id: u.coach_owner_id || '',
      copy_password_from_coach: false,
      max_devices_override: u.max_devices_override != null ? String(u.max_devices_override) : '',
      max_sessions_override: isAssistant ? '' : (u.max_sessions_override != null ? String(u.max_sessions_override) : ''),
      max_participants_override: isAssistant ? '' : (u.max_participants_override != null ? String(u.max_participants_override) : ''),
    });
    setFormError(null);
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setEditingUser(null);
    setFormError(null);
  };

  const parseOverride = (v: string): number | null => (v.trim() === '' ? null : parseInt(v, 10));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormLoading(true);

    const isAssistant = form.role_type === 'assistant';

    const payload: AdminUserInput = {
      login: form.login,
      name: form.name,
      plan: form.plan,
      coach_owner_id: isAssistant ? form.coach_owner_id || null : null,
      copy_password_from_coach: isAssistant && form.copy_password_from_coach,
      max_devices_override: parseOverride(form.max_devices_override),
      max_sessions_override: isAssistant ? null : parseOverride(form.max_sessions_override),
      max_participants_override: isAssistant ? null : parseOverride(form.max_participants_override),
    };

    try {
      if (editingUser) {
        if (form.password) payload.password = form.password;
        if (isAssistant && form.copy_password_from_coach) payload.password = undefined;
        await adminApi.updateUser(editingUser.id, payload);
      } else {
        if (isAssistant && !form.coach_owner_id) {
          setFormError('Выберите тренера для ассистента');
          setFormLoading(false);
          return;
        }
        if (!isAssistant || !form.copy_password_from_coach) {
          if (!form.password) {
            setFormError('Пароль обязателен при создании');
            setFormLoading(false);
            return;
          }
          payload.password = form.password;
        }
        await adminApi.createUser(payload);
      }

      closeModal();
      await loadUsers();
    } catch (e: any) {
      setFormError(e.response?.data?.error || 'Ошибка сохранения');
    } finally {
      setFormLoading(false);
    }
  };

  const handleDelete = async (u: AdminUser) => {
    try {
      await adminApi.deleteUser(u.id);
      setDeleteConfirm(null);
      await loadUsers();
    } catch (e: any) {
      setError(e.response?.data?.error || 'Ошибка удаления');
    }
  };

  const coachCandidates = users.filter((u) => !u.coach_owner_id && (!editingUser || u.id !== editingUser.id));

  const onlineCount = users.filter((u) => u.is_online).length;
  const totalDevices = users.reduce((s, u) => s + (u.active_devices || 0), 0);
  const totalSessions = users.reduce((s, u) => s + (u.active_sessions || 0), 0);
  const totalLiveParticipants = users.reduce((s, u) => s + (u.live_participants_total || 0), 0);
  const totalLiveGuests = users.reduce((s, u) => s + (u.live_participants_guests || 0), 0);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black uppercase tracking-wide">Пользователи</h1>
          <p className="text-white/30 text-xs mt-0.5">Обновление каждые 15 сек</p>
        </div>
        <button
          onClick={openCreate}
          className="px-5 py-2.5 rounded-lg bg-[#15c7a8] text-black font-black text-sm uppercase tracking-wide hover:bg-[#12b399] transition-colors"
        >
          + Создать
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        {[
          { label: 'Онлайн', value: onlineCount, color: 'text-green-400' },
          { label: 'Активных устройств', value: totalDevices, color: 'text-[#15c7a8]' },
          { label: 'Активных сессий', value: totalSessions, color: 'text-blue-400' },
          { label: 'Людей в сессиях', value: totalLiveParticipants, color: 'text-white' },
          { label: 'Гостей в сессиях', value: totalLiveGuests, color: 'text-yellow-300' },
        ].map(({ label, value, color }) => (
          <div key={label} className="bg-white/5 border border-white/10 rounded-xl px-5 py-4">
            <p className="text-white/40 text-xs uppercase tracking-wide mb-1">{label}</p>
            <p className={`text-3xl font-black ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {error && <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-4 mb-5 text-red-400 text-sm">{error}</div>}

      {loading ? (
        <div className="text-center py-20 text-white/40">Загрузка...</div>
      ) : users.length === 0 ? (
        <div className="text-center py-20 text-white/40">Пользователей нет</div>
      ) : (
        <div className="bg-white/5 border border-white/10 rounded-xl overflow-auto">
          <table className="w-full min-w-[1220px]">
            <thead>
              <tr className="border-b border-white/10 text-[11px] font-bold uppercase tracking-wide text-white/40">
                <th className="text-left px-4 py-3">Статус</th>
                <th className="text-left px-4 py-3">Логин</th>
                <th className="text-left px-4 py-3">Имя</th>
                <th className="text-left px-4 py-3">Роль</th>
                <th className="text-left px-4 py-3">План</th>
                <th className="text-center px-3 py-3 text-[#15c7a8]/70" title="Активные устройства">Устр.</th>
                <th className="text-center px-3 py-3 text-blue-400/70" title="Активные сессии">Сесс.</th>
                <th className="text-center px-3 py-3 text-[#15c7a8]/70" title="Сессии с участниками онлайн">Live Сесс.</th>
                <th className="text-center px-3 py-3 text-white/70" title="Участники онлайн в сессиях">Люди</th>
                <th className="text-center px-3 py-3 text-yellow-300/70" title="Гости онлайн в сессиях">Гости</th>
                <th className="text-center px-3 py-3" title="Макс устройств">↑Устр</th>
                <th className="text-center px-3 py-3" title="Макс сессий">↑Сесс</th>
                <th className="text-center px-3 py-3" title="Макс участников">↑Уч.</th>
                <th className="text-left px-4 py-3">Создан</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const def = planDefaults(u.plan);
                const isAssistantUser = Boolean(u.coach_owner_id);
                return (
                  <tr key={u.id} className="border-b border-white/5 last:border-0 hover:bg-white/[0.04] transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${u.is_online ? 'bg-green-400 shadow-[0_0_5px_#4ade80]' : 'bg-white/20'}`} />
                        <span className={`text-xs ${u.is_online ? 'text-green-400 font-semibold' : 'text-white/30'}`}>
                          {u.is_online ? 'онлайн' : 'офлайн'}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm font-mono text-white">{u.email}</td>
                    <td className="px-4 py-3 text-sm text-white/60">{u.name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-white/70">
                      {u.coach_owner_id ? `Ассистент → ${u.coach_login || 'тренер'}` : 'Тренер'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold uppercase ${PLAN_COLORS[u.plan] ?? PLAN_COLORS.free}`}>{u.plan}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-sm font-black ${u.active_devices > 0 ? 'text-[#15c7a8]' : 'text-white/25'}`}>{u.active_devices}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-sm font-black ${u.active_sessions > 0 ? 'text-blue-400' : 'text-white/25'}`}>{u.active_sessions}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-sm font-black ${u.live_sessions > 0 ? 'text-[#15c7a8]' : 'text-white/25'}`}>{u.live_sessions}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-sm font-black ${u.live_participants_total > 0 ? 'text-white' : 'text-white/25'}`}>{u.live_participants_total}</span>
                    </td>
                    <td className="px-3 py-3 text-center">
                      <span className={`text-sm font-black ${u.live_participants_guests > 0 ? 'text-yellow-300' : 'text-white/25'}`}>{u.live_participants_guests}</span>
                    </td>
                    <td className="px-3 py-3 text-center"><OverrideCell val={u.max_devices_override} def={def.devices} /></td>
                    <td className="px-3 py-3 text-center">
                      {isAssistantUser ? <span className="text-white/20 text-xs">—</span> : <OverrideCell val={u.max_sessions_override} def={def.sessions} />}
                    </td>
                    <td className="px-3 py-3 text-center">
                      {isAssistantUser ? <span className="text-white/20 text-xs">—</span> : <OverrideCell val={u.max_participants_override} def={def.participants} />}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/30">{new Date(u.created_at).toLocaleDateString('ru-RU')}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2 justify-end">
                        <Link
                          href={`/admin/users/${u.id}/stats`}
                          className="px-3 py-1.5 rounded-md bg-blue-500/20 hover:bg-blue-500/35 text-blue-200 text-xs font-bold uppercase tracking-wide transition-colors"
                        >
                          Стат
                        </Link>
                        <button onClick={() => openEdit(u)} className="px-3 py-1.5 rounded-md bg-white/10 hover:bg-white/20 text-xs font-bold uppercase tracking-wide transition-colors">Изм.</button>
                        <button onClick={() => setDeleteConfirm(u)} className="px-3 py-1.5 rounded-md bg-red-500/15 hover:bg-red-500/30 text-red-400 text-xs font-bold uppercase tracking-wide transition-colors">Удалить</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm overflow-y-auto">
          <div className="w-full max-w-lg bg-[#0f1c2e] border border-white/15 rounded-2xl p-7 shadow-2xl my-4">
            <h2 className="text-lg font-black uppercase tracking-wide mb-6">
              {editingUser ? 'Редактировать пользователя' : 'Создать пользователя'}
            </h2>

            {formError && <div className="bg-red-500/10 border border-red-500/40 rounded-lg p-3 mb-5 text-red-400 text-sm">{formError}</div>}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-white/50 mb-1.5 uppercase tracking-wide">Логин *</label>
                  <input
                    type="text"
                    className="input-field"
                    value={form.login}
                    onChange={(e) => setForm({ ...form, login: e.target.value })}
                    required
                    disabled={formLoading}
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-white/50 mb-1.5 uppercase tracking-wide">Имя</label>
                  <input
                    type="text"
                    className="input-field"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    disabled={formLoading}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-white/50 mb-1.5 uppercase tracking-wide">Роль</label>
                  <select
                    className="input-field"
                    value={form.role_type}
                    onChange={(e) => {
                      const nextRole = e.target.value as 'trainer' | 'assistant';
                      setForm({
                        ...form,
                        role_type: nextRole,
                        coach_owner_id: nextRole === 'assistant' ? form.coach_owner_id : '',
                        copy_password_from_coach: nextRole === 'assistant' ? form.copy_password_from_coach : false,
                        max_sessions_override: nextRole === 'assistant' ? '' : form.max_sessions_override,
                        max_participants_override: nextRole === 'assistant' ? '' : form.max_participants_override,
                      });
                    }}
                    disabled={formLoading}
                  >
                    <option value="trainer">Тренер</option>
                    <option value="assistant">Ассистент</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-white/50 mb-1.5 uppercase tracking-wide">План</label>
                  <select
                    className="input-field"
                    value={form.plan}
                    onChange={(e) => setForm({ ...form, plan: e.target.value })}
                    disabled={formLoading}
                  >
                    <option value="free">Free</option>
                    <option value="coach">Coach</option>
                    <option value="pro">Pro</option>
                  </select>
                </div>
              </div>

              {form.role_type === 'assistant' && (
                <div className="space-y-3 p-3 rounded-lg border border-white/10 bg-white/5">
                  <div>
                    <label className="block text-xs font-bold text-white/50 mb-1.5 uppercase tracking-wide">Тренер *</label>
                    <select
                      className="input-field"
                      value={form.coach_owner_id}
                      onChange={(e) => setForm({ ...form, coach_owner_id: e.target.value })}
                      disabled={formLoading}
                      required
                    >
                      <option value="">Выберите тренера</option>
                      {coachCandidates.map((coach) => (
                        <option key={coach.id} value={coach.id}>
                          {coach.email}
                        </option>
                      ))}
                    </select>
                  </div>

                  {!editingUser && (
                    <label className="flex items-center gap-2 text-sm text-white/70">
                      <input
                        type="checkbox"
                        checked={form.copy_password_from_coach}
                        onChange={(e) => setForm({ ...form, copy_password_from_coach: e.target.checked })}
                        disabled={formLoading}
                      />
                      Использовать тот же пароль, что у тренера
                    </label>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-white/50 mb-1.5 uppercase tracking-wide">
                    Пароль {!editingUser && '*'}
                    {editingUser && (
                      <span className="text-white/25 normal-case tracking-normal font-normal ml-1">(пусто = не менять)</span>
                    )}
                  </label>
                  <input
                    type="password"
                    className="input-field"
                    value={form.password}
                    onChange={(e) => setForm({ ...form, password: e.target.value })}
                    required={!editingUser && !(form.role_type === 'assistant' && form.copy_password_from_coach)}
                    autoComplete="new-password"
                    disabled={formLoading || (!editingUser && form.role_type === 'assistant' && form.copy_password_from_coach)}
                  />
                </div>
                <div className="flex items-end">
                  {form.role_type === 'assistant' && (
                    <p className="text-xs text-white/45">Ассистент видит сессии тренера, но не может создавать свои.</p>
                  )}
                </div>
              </div>

              <div className="border-t border-white/10 pt-4">
                <p className="text-xs font-bold text-white/40 uppercase tracking-widest mb-3">
                  Индивидуальные лимиты{' '}
                  <span className="font-normal text-white/25 normal-case tracking-normal">(пусто = по плану)</span>
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {([
                    { key: 'max_devices_override', label: 'Устройств' },
                    { key: 'max_sessions_override', label: 'Сессий' },
                    { key: 'max_participants_override', label: 'Участников' },
                  ] as const).map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-xs font-bold text-white/50 mb-1.5 uppercase tracking-wide">{label}</label>
                      <input
                        type="number"
                        min={0}
                        max={999}
                        className="input-field text-center"
                        placeholder={
                          form.role_type === 'assistant' && key !== 'max_devices_override'
                            ? '—'
                            : String(
                                planDefaults(form.plan)[
                                  key === 'max_devices_override' ? 'devices' : key === 'max_sessions_override' ? 'sessions' : 'participants'
                                ]
                              )
                        }
                        value={form[key]}
                        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                        disabled={formLoading || (form.role_type === 'assistant' && key !== 'max_devices_override')}
                      />
                    </div>
                  ))}
                </div>
                {form.role_type === 'assistant' && (
                  <p className="text-xs text-white/35 mt-2">Для ассистента применим только лимит устройств. Лимиты сессий и участников берутся у тренера.</p>
                )}
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold uppercase tracking-wide transition-colors"
                  disabled={formLoading}
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-lg bg-[#15c7a8] text-black font-black text-sm uppercase tracking-wide hover:bg-[#12b399] transition-colors disabled:opacity-50"
                  disabled={formLoading}
                >
                  {formLoading ? 'Сохранение...' : editingUser ? 'Сохранить' : 'Создать'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-[#0f1c2e] border border-white/15 rounded-2xl p-7 shadow-2xl text-center">
            <h2 className="text-lg font-black uppercase mb-2">Удалить?</h2>
            <p className="text-white/50 text-sm mb-6">
              Логин: <span className="text-white font-mono">{deleteConfirm.email}</span>
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 rounded-lg bg-white/10 hover:bg-white/20 text-sm font-bold uppercase tracking-wide transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={() => handleDelete(deleteConfirm)}
                className="flex-1 py-2.5 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-bold uppercase tracking-wide transition-colors"
              >
                Удалить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
