import { create } from 'zustand';
import { adminApi } from '../api';

interface AdminState {
  isAdminAuthenticated: boolean;
  isAdminReady: boolean;
  isAdminLoading: boolean;
  adminError: string | null;
  adminLogin: (login: string, password: string) => Promise<void>;
  adminLogout: () => Promise<void>;
  initAdmin: () => Promise<void>;
  clearAdminError: () => void;
}

export const useAdminStore = create<AdminState>((set) => ({
  isAdminAuthenticated: false,
  isAdminReady: false,
  isAdminLoading: false,
  adminError: null,

  initAdmin: async () => {
    try {
      const response = await adminApi.me();
      set({
        isAdminAuthenticated: Boolean(response.success && response.data?.authenticated),
        isAdminReady: true,
      });
    } catch {
      set({ isAdminAuthenticated: false, isAdminReady: true });
    }
  },

  adminLogin: async (login, password) => {
    set({ isAdminLoading: true, adminError: null });
    try {
      const response = await adminApi.login(login, password);
      if (!response.success) {
        throw new Error(response.error || 'Ошибка входа');
      }

      await adminApi.me();
      set({ isAdminAuthenticated: true, isAdminLoading: false, isAdminReady: true });
    } catch (error: any) {
      set({
        adminError: error.response?.data?.error || error.message || 'Ошибка входа',
        isAdminLoading: false,
        isAdminAuthenticated: false,
        isAdminReady: true,
      });
      throw error;
    }
  },

  adminLogout: async () => {
    try {
      await adminApi.logout();
    } finally {
      set({ isAdminAuthenticated: false, isAdminReady: true });
    }
  },

  clearAdminError: () => set({ adminError: null }),
}));
