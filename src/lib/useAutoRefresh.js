import { useEffect, useRef } from 'react';

/**
 * Re-run `loadFn` when the browser tab becomes visible again, and optionally
 * on a quiet interval. Skips while the document is hidden so background tabs
 * do not hammer the API under multi-user load.
 *
 * @param {() => void | Promise<void>} loadFn
 * @param {object} [opts]
 * @param {number} [opts.intervalMs=90000]  periodic refresh while tab is focused (0 = off)
 * @param {boolean} [opts.enabled=true]
 */
export function useAutoRefresh(loadFn, { intervalMs = 90000, enabled = true } = {}) {
  const fnRef = useRef(loadFn);
  fnRef.current = loadFn;
  const lastRun = useRef(0);

  useEffect(() => {
    if (!enabled) return undefined;

    const run = () => {
      const now = Date.now();
      // Debounce: never fire more than once every 8s
      if (now - lastRun.current < 8000) return;
      lastRun.current = now;
      try {
        const r = fnRef.current?.();
        if (r && typeof r.then === 'function') r.catch(() => {});
      } catch {
        /* ignore */
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') run();
    };
    const onFocus = () => run();

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onFocus);

    let timer = null;
    if (intervalMs > 0) {
      timer = setInterval(() => {
        if (document.visibilityState === 'visible') run();
      }, intervalMs);
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onFocus);
      if (timer) clearInterval(timer);
    };
  }, [enabled, intervalMs]);
}
