import { Page } from '@/components/Page';
import { Skeleton } from '@/components/ui/skeleton';

/** A page whose data is still loading from the device database: title, back and grey blocks. */
export function PageSkeleton({ title }: { title: string }) {
  return (
    <Page title={title} back withTabBar={false}>
      <div className="grid gap-4" aria-busy="true">
        <Skeleton className="h-48 rounded-2xl" />
        <Skeleton className="h-32 rounded-2xl" />
      </div>
    </Page>
  );
}
