'use client';

import { useState } from 'react';
import { sessionsApi } from '@/lib/api';
import { useUiStore } from '@/lib/stores/uiStore';
import { t } from '@/lib/i18n';

interface CreateSessionModalProps {
  onClose: () => void;
  onCreated: () => void;
}

function isYoutubeUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const candidates = [trimmed];
  if (!/^https?:\/\//i.test(trimmed)) {
    candidates.push(`https://${trimmed}`);
  }

  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
      if (
        host === 'youtu.be' ||
        host === 'youtube.com' ||
        host.endsWith('.youtube.com') ||
        host === 'youtube-nocookie.com' ||
        host.endsWith('.youtube-nocookie.com')
      ) {
        return true;
      }
    } catch {
      continue;
    }
  }

  return false;
}

export default function CreateSessionModal({ onClose, onCreated }: CreateSessionModalProps) {
  const { language } = useUiStore();
  const [formData, setFormData] = useState({
    name: '',
    youtubeUrl: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!formData.name || !formData.youtubeUrl) {
      setError(t(language, 'modalFillAllFields'));
      return;
    }

    if (!isYoutubeUrl(formData.youtubeUrl)) {
      setError(t(language, 'modalInvalidYoutube'));
      return;
    }

    setIsLoading(true);
    try {
      const response = await sessionsApi.create(formData.name, formData.youtubeUrl);
      if (response.success) {
        onCreated();
      } else {
        setError(response.error || t(language, 'modalCreateFailed'));
      }
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || t(language, 'modalCreateFailed'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
      <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-8 max-w-lg w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-2xl font-black uppercase">{t(language, 'modalCreateTitle')}</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-2xl" disabled={isLoading}>
            x
          </button>
        </div>

        {error && (
          <div className="bg-red-500/10 border border-red-500/50 rounded-lg p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="name" className="block text-sm font-bold text-white/80 mb-2 uppercase tracking-wide">
              {t(language, 'modalSessionName')}
            </label>
            <input
              id="name"
              type="text"
              className="input-field"
              placeholder={t(language, 'modalSessionNamePlaceholder')}
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              disabled={isLoading}
              required
            />
          </div>

          <div>
            <label htmlFor="youtubeUrl" className="block text-sm font-bold text-white/80 mb-2 uppercase tracking-wide">
              {t(language, 'modalYoutubeUrl')}
            </label>
            <input
              id="youtubeUrl"
              type="url"
              className="input-field"
              placeholder="https://www.youtube.com/watch?v=..."
              value={formData.youtubeUrl}
              onChange={(e) => setFormData({ ...formData, youtubeUrl: e.target.value })}
              disabled={isLoading}
              required
            />
            <p className="text-xs text-white/40 mt-2">{t(language, 'modalYoutubeHint')}</p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 bg-white/5 text-white px-6 py-3 rounded-lg font-bold uppercase hover:bg-white/10 transition-colors"
              disabled={isLoading}
            >
              {t(language, 'cancel')}
            </button>
            <button type="submit" className="flex-1 btn-primary py-3 disabled:opacity-50 disabled:cursor-not-allowed" disabled={isLoading}>
              {isLoading ? t(language, 'creating') : t(language, 'createNewSession')}
            </button>
          </div>
        </form>

        <div className="mt-6 p-4 bg-premier-cyan/5 border border-premier-cyan/20 rounded-lg">
          <p className="text-sm text-premier-cyan font-bold mb-2">{t(language, 'modalQuickTipTitle')}</p>
          <p className="text-xs text-white/60">{t(language, 'modalQuickTipText')}</p>
        </div>
      </div>
    </div>
  );
}
