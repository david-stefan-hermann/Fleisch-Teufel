import { useEffect, useState } from 'react';
import { endpoints } from '@/lib/api';

type AiStatus = 'loading' | 'on' | 'off' | 'offline';

/** The server's last answer on this device: offline, an AI that is off stays 'off' (no "Nur online"). */
const KNOWN_KEY = 'ft.aiEnabled';

function remember(enabled: boolean) {
  try {
    localStorage.setItem(KNOWN_KEY, enabled ? '1' : '0');
  } catch {
    // Storage blocked: offline then counts as 'offline' as before.
  }
}

function offlineStatus(): AiStatus {
  try {
    return localStorage.getItem(KNOWN_KEY) === '0' ? 'off' : 'offline';
  } catch {
    return 'offline';
  }
}

/**
 * Whether the AI features can be used right now: 'on', 'off' (not set up on the server, also
 * offline when the server said so before), 'offline' (server not reachable, e.g. WireGuard down) or
 * 'loading'. Asks the server again when the device comes back online.
 */
export function useAiStatus(): AiStatus {
  const [status, setStatus] = useState<AiStatus>('loading');
  useEffect(() => {
    let alive = true;
    const check = () =>
      endpoints.aiStatus().then(
        (s) => {
          remember(s.enabled);
          if (alive) setStatus(s.enabled ? 'on' : 'off');
        },
        () => alive && setStatus(offlineStatus()),
      );
    const offline = () => setStatus(offlineStatus());
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
