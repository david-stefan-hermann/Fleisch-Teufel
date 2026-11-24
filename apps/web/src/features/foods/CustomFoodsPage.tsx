import { get, N } from '@ft/shared';
import { Link } from '@tanstack/react-router';
import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Salad } from 'lucide-react';
import { rowClass } from '@/components/tappable';
import { useDb } from '@/app/session';
import { EmptyState, Page } from '@/components/Page';
import { Button } from '@/components/ui/button';
import { fmt0 } from '@/lib/format';

export function CustomFoodsPage() {
  const db = useDb();
  const foods = useLiveQuery(() => db.customFoods.filter((f) => !f.deleted).sortBy('name'), [db]);
  return (
    <Page
      title="Eigene Lebensmittel"
      back="/more"
      withTabBar={false}
      actions={
        <Button variant="ghost" size="icon" asChild>
          <Link to="/custom-food/$id" params={{ id: 'new' }} aria-label="Neues Lebensmittel">
            <Plus aria-hidden />
          </Link>
        </Button>
      }
    >
      {foods?.length === 0 && <EmptyState icon={<Salad />} title="Noch keine eigenen Lebensmittel" />}
      <ul className="-mx-4 divide-y divide-border/70">
        {foods?.map((f) => (
          <li key={f.id}>
            <Link to="/custom-food/$id" params={{ id: f.id }} className={rowClass}>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{f.name}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {[f.brand, f.barcode].filter(Boolean).join(' · ') || 'Eigenes Lebensmittel'}
                </div>
              </div>
              <div className="tabular text-right text-sm">
                <div className="font-semibold">{fmt0(get(f.nutrients, N.kcal))}</div>
                <div className="text-[11px] text-muted-foreground">kcal/100&nbsp;{f.unit}</div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Page>
  );
}
