import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '../types';
import { authApi } from '../api';
import { clearDemoAuthMarker } from '../constants/demo';

interface AuthState {
  user: User | null;
  isLoading: boolean;
  error: string | null;
  login: (login: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isLoading: false,
      error: null,

      login: async (login: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await authApi.login(login, password);
          if (response.success && response.data) {
            clearDemoAuthMarker();
            set({ user: response.data.user, isLoading: false });
          } else {
            throw new Error(response.error || 'Login failed');
          }
        } catch (error: any) {
          set({ 
            error: error.response?.data?.error || error.message || 'Login failed',
            isLoading: false 
          });
          throw error;
        }
      },

      register: async (email: string, password: string, name?: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await authApi.register(email, password, name);
          if (response.success && response.data) {
            clearDemoAuthMarker();
            set({ user: response.data.user, isLoading: false });
          } else {
            throw new Error(response.error || 'Registration failed');
          }
        } catch (error: any) {
          set({ 
            error: error.response?.data?.error || error.message || 'Registration failed',
            isLoading: false 
          });
          throw error;
        }
      },

      logout: async () => {
        set({ isLoading: true });
        try {
          await authApi.logout();
          clearDemoAuthMarker();
          set({ user: null, isLoading: false });
        } catch (error) {
          set({ isLoading: false });
        }
      },

      checkAuth: async () => {
        set({ isLoading: true });
        try {
          const response = await authApi.me();
          if (response.success && response.data) {
            set({ user: response.data, isLoading: false });
          } else {
            set({ user: null, isLoading: false });
          }
        } catch (error) {
          set({ user: null, isLoading: false });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user }),
    }
  )
);
