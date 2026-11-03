import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Theme } from '../../shared/types.ts';

const BASE = '/api/v1';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export const OFFLINE_STATUS = 0;

// True while responses are coming from the service worker's saved copies.
let servedFromCache = false;
const cacheSubs = new Set<() => void>();
function setServedFromCache(v: boolean) {
  if (v === servedFromCache) return;
  servedFromCache = v;
  cacheSubs.forEach((f) => f());
}
export const useServedFromCache = () => useSyncExternalStore((f) => { cacheSubs.add(f); return () => cacheSubs.delete(f); }, () => servedFromCache);

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    setServedFromCache(true);
    throw new ApiError(OFFLINE_STATUS, "This needs the DevArt server, which can't be reached right now.");
  }
  setServedFromCache(res.headers.get('x-devart-offline') === '1');
  const isJson = res.headers.get('content-type')?.includes('json');
  const data = isJson ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, (isJson && (data as any).error) || `Request failed (${res.status})`);
  return data as T;
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b: unknown = {}) => api<T>('POST', p, b);
export const patch = <T = any>(p: string, b: unknown) => api<T>('PATCH', p, b);
export const del = <T = any>(p: string, b?: unknown) => api<T>('DELETE', p, b);

export interface User { id: string; email: string; name: string; theme: Theme }

// Small global stores for the local user, theme, and toasts.
let currentUser: User | null | undefined;
const userSubs = new Set<() => void>();
export function setUser(u: User | null) {
  currentUser = u;
  if (u) applyTheme(u.theme);
  userSubs.forEach((f) => f());
}
export const useUser = () => useSyncExternalStore((f) => { userSubs.add(f); return () => userSubs.delete(f); }, () => currentUser);

let theme: Theme = (() => { try { return localStorage.getItem('devart-theme') === 'dark' ? 'dark' : 'light'; } catch { return 'light'; } })();
const themeSubs = new Set<() => void>();
export function applyTheme(t: Theme) {
  theme = t;
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name=theme-color]')?.setAttribute('content', t === 'dark' ? '#14161b' : '#ffffff');
  try { localStorage.setItem('devart-theme', t); } catch { /* storage may be blocked */ }
  themeSubs.forEach((f) => f());
}
applyTheme(theme);
export const useTheme = () => useSyncExternalStore((f) => { themeSubs.add(f); return () => themeSubs.delete(f); }, () => theme);
export function toggleTheme() {
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  if (currentUser) patch('/me', { theme: next }).catch(() => {});
}

let toasts: { id: number; text: string; error: boolean }[] = [];
const toastSubs = new Set<() => void>();
export function toast(text: string, error = false) {
  const id = Date.now() + Math.random();
  toasts = [...toasts, { id, text, error }];
  toastSubs.forEach((f) => f());
  setTimeout(() => { toasts = toasts.filter((t) => t.id !== id); toastSubs.forEach((f) => f()); }, error ? 6000 : 3000);
}
export const toastError = (e: unknown) => toast((e as Error).message, true);
export const useToasts = () => useSyncExternalStore((f) => { toastSubs.add(f); return () => toastSubs.delete(f); }, () => toasts);

export function useLoad<T>(path: string | null, deps: unknown[] = []): { data: T | undefined; reload: () => void; error?: string; offline: boolean } {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string>();
  const [offline, setOffline] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    get<T>(path).then((d) => { if (live) { setData(d); setError(undefined); setOffline(false); } }).catch((e) => { if (live) { setError(e.message); setOffline(e.status === OFFLINE_STATUS); } });
    return () => { live = false; };
  }, [path, tick, ...deps]);
  return { data, error, offline, reload: () => setTick((t) => t + 1) };
}

export function download(url: string, name?: string) {
  const a = document.createElement('a');
  a.href = url;
  if (name) a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
}

export const timeAgo = (t: number) => {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(t).toLocaleDateString();
};
