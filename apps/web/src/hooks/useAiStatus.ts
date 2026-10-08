import { useEffect, useState } from 'react';
import { endpoints } from '@/lib/api';

/**
 * Whether the AI features can be used right now: 'on', 'off' (not set up on the server),
 * 'offline' (server not reachable, e.g. WireGuard down) or 'loading'. Asks the server again when
 * the device comes back online.
 */
export function useAiStatus(): 'loading' | 'on' | 'off' | 'offline' {
  const [status, setStatus] = useState<'loading' | 'on' | 'off' | 'offline'>('loading');
  useEffect(() => {
    let alive = true;
    const check = () =>
      endpoints.aiStatus().then(
        (s) => alive && setStatus(s.enabled ? 'on' : 'off'),
        () => alive && setStatus('offline'),
      );
    const offline = () => setStatus('offline');
    void check();
    window.addEventListener('online', check);
    window.addEventListener('offline', offline);
    return () => {
      alive = false;
      window.removeEventListener('online', check);
      window.removeEventListener('offline', offline);
    };
  }, []);
  return status;
}
