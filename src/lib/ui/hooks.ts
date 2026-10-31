'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api';

export function revalidateStudio() { window.dispatchEvent(new Event('studio:refresh')); }
export function useResource<T>(path: string | null, loader: (path: string, signal: AbortSignal) => Promise<T> = (path, signal) => api<T>(path, { signal })) {
  const [state, setState] = useState<{ path: string | null; data?: T; error?: unknown; loading: boolean }>({ path, loading: true });
  const [revision, setRevision] = useState(0);
  const mounted = useRef(true);
  const load = useRef(loader); load.current = loader;
  const reload = useCallback(() => setRevision(value => value + 1), []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    setState(previous => ({ path, data: previous.path === path ? previous.data : undefined, loading: true }));
    load.current(path, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)])).then(data => {
      if (!controller.signal.aborted && mounted.current) setState({ path, data, loading: false });
    }).catch(error => { if (!controller.signal.aborted && mounted.current) setState(previous => ({ path, data: previous.data, error, loading: false })); });
    return () => controller.abort();
  }, [path, revision]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('focus', reload); window.addEventListener('online', reload); window.addEventListener('studio:refresh', reload); document.addEventListener('visibilitychange', visible);
    return () => { window.removeEventListener('focus', reload); window.removeEventListener('online', reload); window.removeEventListener('studio:refresh', reload); document.removeEventListener('visibilitychange', visible); };
  }, [reload]);
  return { ...(state.path === path ? state : { data: undefined, error: undefined, loading: true }), reload };
}
export async function allPages<T>(path: string, signal?: AbortSignal): Promise<T[]> {
  const items: T[] = [];
  for (let offset = 0; offset <= 100000; offset += 100) {
    const page = await api<{ items: T[] }>(`${path}${path.includes('?') ? '&' : '?'}limit=100&offset=${offset}`, { signal });
    items.push(...page.items); if (page.items.length < 100) break;
  }
  return items;
}

export function useUnsavedChanges(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    const navigate = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
      if (!link || link.target === '_blank' || link.hasAttribute('download')) return;
      const destination = new URL(link.href, location.href);
      if (destination.pathname === location.pathname && destination.search === location.search) return;
      if (!window.confirm('Você tem alterações não salvas. Deseja descartá-las e sair desta página?')) { event.preventDefault(); event.stopImmediatePropagation(); }
    };
    window.addEventListener('beforeunload', beforeUnload); document.addEventListener('click', navigate, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('click', navigate, true); };
  }, [dirty]);
}
