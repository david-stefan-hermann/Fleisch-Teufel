/**
 * Session handling, offline-first: the signed-in user is remembered on the device, so the app
 * opens instantly and works without a connection. The server session (cookie) is checked in
 * the background; if it expired, local data stays and the user is asked to sign in again.
 */
import type { PublicUser, ServerInfo } from '@ft/shared';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, endpoints } from '@/lib/api';
import { UserDb, userDbName } from '@/db/dexie';
import { SyncEngine } from '@/sync/syncEngine';
import { startQueueProcessing } from '@/features/ai/queue';
import { startAssistantQueue } from '@/features/assistant/queue';
import { disableReminder } from '@/lib/reminder';
import { watchDayStart } from '@/lib/day';
import { recordError } from '@/lib/errorLog';

const USER_KEY = 'ft.user';
/** The server's last /api/info answer: a start without connection keeps the features it offers. */
const SERVER_INFO_KEY = 'ft.serverInfo';

export interface Session {
  user: PublicUser;
  db: UserDb;
  sync: SyncEngine;
}

interface SessionContextValue {
  session: Session | null;
  serverInfo: ServerInfo | null;
  /** True when the server rejected the stored session (sign in again to resume syncing). */
  needsReauth: boolean;
  signIn: (user: PublicUser) => void;
  signOut: (opts?: { wipeLocal?: boolean }) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

function readStoredUser(): PublicUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as PublicUser) : null;
  } catch {
    return null;
  }
}

function readServerInfo(): ServerInfo | null {
  try {
    const raw = localStorage.getItem(SERVER_INFO_KEY);
    return raw ? (JSON.parse(raw) as ServerInfo) : null;
  } catch {
    return null;
  }
}

function storeServerInfo(info: ServerInfo) {
  try {
    localStorage.setItem(SERVER_INFO_KEY, JSON.stringify(info));
  } catch {
    // Storage blocked: the answer still holds for this run.
  }
}

function open(user: PublicUser, onUnauthorized: () => void): Session {
  const db = new UserDb(userDbName(user.id));
  const sync = new SyncEngine(db, {
    onUnauthorized,
    appVersion: __APP_VERSION__,
    // The engine stays free of `@/` imports (API tests run it), so the error log is wired here.
    onReset: (i) =>
      recordError(
        new Error(
          `Server-Datenbank zurückgesetzt (${i.reason}): ${i.records} Datensätze werden erneut hochgeladen`,
        ),
        'sync',
      ),
  });
  return { user, db, sync };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [needsReauth, setNeedsReauth] = useState(false);
  const [session, setSession] = useState<Session | null>(() => {
    const u = readStoredUser();
    return u ? open(u, () => setNeedsReauth(true)) : null;
  });
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(readServerInfo);

  // Server info (registration open, AI available) follows the login state, not only the start.
  // Until the server answered once in this run (a cold start often has no connection yet, e.g.
  // the VPN still coming up), ask again when the device is online or the app is shown again.
  useEffect(() => {
    let alive = true;
    let answered = false;
    let asking = false;
    const ask = () => {
      if (answered || asking || document.visibilityState !== 'visible') return;
      asking = true;
      endpoints.info().then(
        (info) => {
          answered = true;
          asking = false;
          storeServerInfo(info);
          if (alive) setServerInfo(info);
        },
        () => {
          asking = false;
        },
      );
    };
    ask();
    const timer = window.setInterval(ask, 30_000);
    window.addEventListener('online', ask);
    document.addEventListener('visibilitychange', ask);
    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener('online', ask);
      document.removeEventListener('visibilitychange', ask);
    };
  }, [session?.user.id]);

  // "Abmelden" that happened offline: the server cookie is still valid. Without a stored user but
  // with a live cookie, end the server session first thing.
  useEffect(() => {
    if (session || readStoredUser()) return;
    endpoints.me().then(
      () => void endpoints.logout().catch(() => {}),
      () => {},
    );
  }, [session]);

  useEffect(() => {
    if (!session) return;
    session.sync.start();
    const stopQueue = startQueueProcessing(session.db);
    const stopAssistant = startAssistantQueue(session.db);
    const stopDay = watchDayStart(session.db);
    // Background check of the server session.
    endpoints.me().then(
      () => setNeedsReauth(false),
      (e) => {
        if (e instanceof ApiError && e.status === 401) setNeedsReauth(true);
      },
    );
    return () => {
      session.sync.stop();
      stopQueue();
      stopAssistant();
      stopDay();
    };
  }, [session]);

  const signIn = useCallback(
    (user: PublicUser) => {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
      setNeedsReauth(false);
      // Side effects outside the updater: StrictMode runs updaters twice (a second UserDb/engine).
      if (session?.user.id === user.id) {
        session.sync.schedule(0);
        return;
      }
      session?.db.close();
      setSession(open(user, () => setNeedsReauth(true)));
    },
    [session],
  );

  const signOut = useCallback(
    async (opts: { wipeLocal?: boolean } = {}) => {
      // The reminder belongs to the account, not the device: it goes with the sign-out (best effort).
      await disableReminder();
      try {
        await endpoints.logout();
      } catch {
        /* offline: the cookie expires on its own */
      }
      localStorage.removeItem(USER_KEY);
      if (session) {
        session.sync.stop();
        if (opts.wipeLocal) await session.db.delete();
        else session.db.close();
      }
      setSession(null);
    },
    [session],
  );

  const value = useMemo(
    () => ({ session, serverInfo, needsReauth, signIn, signOut }),
    [session, serverInfo, needsReauth, signIn, signOut],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSessionContext(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('SessionProvider missing');
  return ctx;
}

/** For screens behind the auth guard. */
export function useSession(): Session {
  const { session } = useSessionContext();
  if (!session) throw new Error('not signed in');
  return session;
}

export function useDb(): UserDb {
  return useSession().db;
}
