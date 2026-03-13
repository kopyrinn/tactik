export const DEMO_AUTH_STORAGE_KEY = 'tactik:demo-auth';
export const DEMO_AUTH_STORAGE_EVENT = 'tactik:demo-auth-updated';

type DemoAuthMarker = {
  expiresAt: string;
  login?: string;
};

export function setDemoAuthMarker(marker: DemoAuthMarker) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(DEMO_AUTH_STORAGE_KEY, JSON.stringify(marker));
  window.dispatchEvent(new Event(DEMO_AUTH_STORAGE_EVENT));
}

export function clearDemoAuthMarker() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(DEMO_AUTH_STORAGE_KEY);
  window.dispatchEvent(new Event(DEMO_AUTH_STORAGE_EVENT));
}
