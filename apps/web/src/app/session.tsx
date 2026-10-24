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

const USER_KEY = 'ft.user';

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

function open(user: PublicUser, onUnauthorized: () => void): Session {
  const db = new UserDb(userDbName(user.id));
  const sync = new SyncEngine(db, { onUnauthorized });
  return { user, db, sync };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [needsReauth, setNeedsReauth] = useState(false);
  const [session, setSession] = useState<Session | null>(() => {
    const u = readStoredUser();
    return u ? open(u, () => setNeedsReauth(true)) : null;
  });
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);

  // Server info (registration open, AI available) follows the login state, not only the start.
  useEffect(() => {
    endpoints.info().then(setServerInfo, () => {});
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
