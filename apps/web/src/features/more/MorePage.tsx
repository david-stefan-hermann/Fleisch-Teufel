import { Link } from '@tanstack/react-router';
import {
  Dumbbell,
  ChevronRight,
  Database,
  Info,
  Palette,
  ListOrdered,
  Salad,
  Target,
  Trash2,
  User,
  UserCog,
  UtensilsCrossed,
} from 'lucide-react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { ReactNode } from 'react';
import { useSession } from '@/app/session';
import { Page, Section } from '@/components/Page';
import { syncLabel, useSyncState } from '@/components/SyncIndicator';
import { Switch } from '@/components/ui/switch';
import { trashCount } from '@/db/trash';
import { patchRecord, saveRecord } from '@/db/write';
import { useSettings } from '@/hooks/data';
import { useAppearance } from '@/lib/appearance';

const THEME_LABEL = { system: 'Wie das System', light: 'Hell', dark: 'Dunkel' } as const;
const ICON_LABEL = { auto: 'wie die App', light: 'hell', dark: 'dunkel' } as const;

function Row({ to, icon, label, hint }: { to: string; icon: ReactNode; label: string; hint?: string }) {
  return (
    <li>
      <Link
        to={to}
        className="flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none [&>svg:first-child]:size-5 [&>svg:first-child]:text-muted-foreground"
      >
        {icon}
        <div className="min-w-0 flex-1">
          <div className="font-medium">{label}</div>
          {hint && <div className="truncate text-xs text-muted-foreground">{hint}</div>}
        </div>
        <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
      </Link>
    </li>
  );
}

export function MorePage() {
  const { db, user } = useSession();
  const settings = useSettings();
  const sync = useSyncState();
  const trashed = useLiveQuery(() => trashCount(db), [db]);
  const look = useAppearance();
  return (
    <Page title="Mehr">
      <Section>
        <ul className="divide-y divide-border/70">
          <Row
            to="/goals"
            icon={<Target aria-hidden />}
            label="Ziele"
            hint="Kalorien, Makros je Wochentag, Nährstoffe"
          />
          <Row
            to="/settings/profile"
            icon={<User aria-hidden />}
            label="Profil"
            hint="Körperdaten, Aktivität, Zielgewicht"
          />
          <Row
            to="/settings/meals"
            icon={<ListOrdered aria-hidden />}
            label="Mahlzeiten"
            hint={settings?.mealNames.join(' · ')}
          />
        </ul>
      </Section>
      <Section>
        <ul className="divide-y divide-border/70">
          <Row to="/custom-foods" icon={<Salad aria-hidden />} label="Eigene Lebensmittel" />
          <Row to="/meals" icon={<UtensilsCrossed aria-hidden />} label="Gespeicherte Meals" />
          <Row to="/trainings" icon={<Dumbbell aria-hidden />} label="Gespeicherte Trainings" />
        </ul>
      </Section>
      <Section>
        <div className="flex min-h-14 items-center gap-3 px-4 py-2">
          <label htmlFor="exercise-credit" className="min-w-0 flex-1">
            <div className="font-medium">Trainingskalorien anrechnen</div>
            <div className="text-xs text-muted-foreground">
              Erhöht das Tagesziel um den Trainingsverbrauch
            </div>
          </label>
          <Switch
            id="exercise-credit"
            checked={settings?.addExerciseCalories ?? true}
            onCheckedChange={async (v) => {
              if (!settings) return;
              if (settings.updatedAt === 0)
                await saveRecord(db, 'settings', { ...settings, addExerciseCalories: v });
              else await patchRecord(db, 'settings', settings.id, { addExerciseCalories: v });
            }}
          />
        </div>
      </Section>
      <Section>
        <ul className="divide-y divide-border/70">
          <Row
            to="/settings/appearance"
            icon={<Palette aria-hidden />}
            label="Aussehen"
            hint={`${THEME_LABEL[look.theme]} · Icon ${ICON_LABEL[look.icon]}`}
          />
          <Row
            to="/settings/data"
            icon={<Database aria-hidden />}
            label="Daten & Synchronisation"
            hint={syncLabel(sync)}
          />
          <Row
            to="/settings/trash"
            icon={<Trash2 aria-hidden />}
            label="Papierkorb"
            hint={
              trashed === undefined
                ? undefined
                : trashed === 0
                  ? 'Leer'
                  : `${trashed} ${trashed === 1 ? 'Eintrag' : 'Einträge'}`
            }
          />
          <Row to="/settings/account" icon={<UserCog aria-hidden />} label="Konto" hint={user.email} />
          <Row
            to="/about"
            icon={<Info aria-hidden />}
            label="Über Fleisch-Teufel"
            hint="Quellen, Lizenzen, Version"
          />
        </ul>
      </Section>
    </Page>
  );
}
