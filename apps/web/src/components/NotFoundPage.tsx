import { useRouter } from '@tanstack/react-router';
import { useSyncState } from '@/components/SyncIndicator';
import { EmptyState, Page } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { goBackOr } from '@/lib/history';

/**
 * A record from the URL that this device does not have (unknown id, deleted, not synced yet): page
 * title, what is missing and a way back. Offline it may only not have arrived yet, so it says that
 * instead. `offline` overrides the sync state (a server lookup knows better).
 */
export function NotFoundPage({
  title,
  what,
  offline,
}: {
  title: string;
  /** "Eintrag nicht gefunden", "Lebensmittel nicht gefunden". */
  what: string;
  offline?: boolean;
}) {
  const router = useRouter();
  const sync = useSyncState();
  const isOffline = offline ?? sync.status === 'offline';
  return (
    <Page title={title} back withTabBar={false}>
      <EmptyState title={isOffline ? 'Nicht auf diesem Gerät, online erneut öffnen' : what} />
      <div className="flex justify-center">
        <Button
          variant="outline"
          onClick={() => goBackOr(router.history, 1, () => void router.navigate({ to: '/' }))}
        >
          Zurück
        </Button>
      </div>
    </Page>
  );
}
