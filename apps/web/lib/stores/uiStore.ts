import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppLanguage } from '@/lib/i18n';

interface UiState {
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      language: 'ru',
      setLanguage: (language) => set({ language }),
    }),
    {
      name: 'ui-preferences',
      partialize: (state) => ({ language: state.language }),
    }
  )
);
