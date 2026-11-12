import { useBlocker, useNavigate, useRouter, type ShouldBlockFn } from '@tanstack/react-router';
import { useCallback, useRef } from 'react';
import { goBackOr } from '@/lib/history';

/**
 * Leaving guard of a settings form with a footer "Speichern" (goals, profile, meal names), like the
 * meal editor: leaving with changes is blocked (render `DiscardDialog` with `blocker`), and
 * `close()` after saving goes back to the page that opened the form (else `fallback`) without asking.
 */
export function useSettingsForm(dirty: boolean, fallback: '/more') {
  const router = useRouter();
  const navigate = useNavigate();
  // Set right before leaving after a save: the form still shows its (now saved) values then.
  const leaving = useRef(false);
  const shouldBlockFn = useCallback<ShouldBlockFn>(() => !leaving.current && dirty, [dirty]);
  const blocker = useBlocker({ shouldBlockFn, withResolver: true, enableBeforeUnload: false });
  const close = () => {
    leaving.current = true;
    goBackOr(router.history, 1, () => void navigate({ to: fallback, ignoreBlocker: true }));
  };
  return { blocker, close };
}
