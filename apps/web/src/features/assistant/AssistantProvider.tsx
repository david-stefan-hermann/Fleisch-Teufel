/**
 * The assistant of the signed-in layout: one controller while the server offers it, used by the
 * floating button and by the add sheet (which always shows the button). The floating button is on
 * every page, also the camera, unless the person switched it off; switched off it shows only while
 * an utterance runs (recording, text, thinking, a question). It steps aside while a dialog is open
 * (Radix, vaul and `FullscreenOverlay` all carry `role=dialog`), unless it is busy with an utterance.
 */
import { today, type ISODate } from '@ft/shared';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';
import { useSession, useSessionContext } from '@/app/session';
import { ASSISTANT_SCALE, useAppearance } from '@/lib/appearance';
import { AssistantButton } from './AssistantButton';
import { AssistantController } from './controller';
import { useSkin } from './skins/useSkin';

const DIALOG = '[role="dialog"], [role="alertdialog"]';

function subscribeDialogs(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['role'] });
  return () => mo.disconnect();
}
const dialogOpen = () => document.querySelector(DIALOG) !== null;

const AssistantContext = createContext<AssistantController | null>(null);

/** The assistant's controller; null while the server does not offer the assistant. */
export function useAssistant(): AssistantController | null {
  return useContext(AssistantContext);
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { serverInfo } = useSessionContext();
  const { db } = useSession();
  const router = useRouter();
  const enabled = !!serverInfo?.assistantEnabled;
  const voice = !!serverInfo?.voiceEnabled;
  const controller = useMemo(
    () =>
      enabled
        ? new AssistantController({
            db,
            voice,
            // Read when an utterance is made: the diary's day, else today.
            shownDate: () => {
              const loc = router.state.location;
              const date = (loc.search as { date?: unknown }).date;
              return loc.pathname === '/' && typeof date === 'string' ? (date as ISODate) : today();
            },
            openPhoto: (search) => void router.navigate({ to: '/photo', search }),
          })
        : null,
    [enabled, voice, db, router],
  );
  useEffect(() => controller?.attach(), [controller]);
  return (
    <AssistantContext.Provider value={controller}>
      {children}
      {controller && <FloatingAssistant controller={controller} />}
    </AssistantContext.Provider>
  );
}

function FloatingAssistant({ controller }: { controller: AssistantController }) {
  const { db } = useSession();
  const { assistantButton, assistantSize } = useAppearance();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const dialog = useSyncExternalStore(subscribeDialogs, dialogOpen);
  const waiting = useLiveQuery(() => db.assistantTurns.where('status').equals('waiting').count(), [db]) ?? 0;
  const scale = ASSISTANT_SCALE[assistantSize];
  const skin = useSkin(scale);
  const busy = state.phase !== 'idle' && state.phase !== 'asking';
  if (path === '/onboarding') return null;
  if (!assistantButton && state.phase === 'idle') return null;
  if (dialog && !busy) return null;
  return <AssistantButton controller={controller} waiting={waiting} skin={skin} scale={scale} />;
}
