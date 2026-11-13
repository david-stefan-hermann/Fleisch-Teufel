/**
 * Mounts the assistant in the signed-in layout: on every page, also the camera, while the server
 * offers it and the person did not switch the button off. It steps aside while a dialog is open
 * (Radix, vaul and `FullscreenOverlay` all carry `role=dialog`), unless it is busy with an utterance.
 */
import { today, type ISODate } from '@ft/shared';
import { useRouter, useRouterState } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSession, useSessionContext } from '@/app/session';
import { useAppearance } from '@/lib/appearance';
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

export function AssistantMount() {
  const { serverInfo } = useSessionContext();
  const { assistantButton } = useAppearance();
  const path = useRouterState({ select: (s) => s.location.pathname });
  if (!serverInfo?.assistantEnabled || !assistantButton || path === '/onboarding') return null;
  return <Assistant voice={!!serverInfo.voiceEnabled} />;
}

function Assistant({ voice }: { voice: boolean }) {
  const { db } = useSession();
  const router = useRouter();
  const [controller] = useState(
    () =>
      new AssistantController({
        db,
        voice,
        // Read when an utterance is made: the diary's day, else today.
        shownDate: () => {
          const loc = router.state.location;
          const date = (loc.search as { date?: unknown }).date;
          return loc.pathname === '/' && typeof date === 'string' ? (date as ISODate) : today();
        },
        openPhoto: (search) => void router.navigate({ to: '/photo', search }),
      }),
  );
  useEffect(() => controller.attach(), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const dialog = useSyncExternalStore(subscribeDialogs, dialogOpen);
  const waiting = useLiveQuery(() => db.assistantTurns.where('status').equals('waiting').count(), [db]) ?? 0;
  const skin = useSkin();
  const busy = state.phase !== 'idle' && state.phase !== 'asking';
  if (dialog && !busy) return null;
  return <AssistantButton controller={controller} waiting={waiting} skin={skin} />;
}
