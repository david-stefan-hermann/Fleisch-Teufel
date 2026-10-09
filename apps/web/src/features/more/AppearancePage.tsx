import { Monitor, Moon, Sun } from 'lucide-react';
import type { ReactNode } from 'react';
import { Page, Section } from '@/components/Page';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  ICON_FILES,
  setIconPref,
  setThemePref,
  useAppearance,
  type IconPref,
  type ThemePref,
} from '@/lib/appearance';

const THEMES: { value: ThemePref; label: string; icon: ReactNode }[] = [
  { value: 'system', label: 'System', icon: <Monitor aria-hidden /> },
  { value: 'light', label: 'Hell', icon: <Sun aria-hidden /> },
  { value: 'dark', label: 'Dunkel', icon: <Moon aria-hidden /> },
];

/** Mehr → Aussehen: app theme and logo variant of this device. */
export function AppearancePage() {
  const a = useAppearance();
  const icons: { value: IconPref; label: string; files: string[] }[] = [
    { value: 'auto', label: 'Wie die App', files: [ICON_FILES.light.logo, ICON_FILES.dark.logo] },
    { value: 'light', label: 'Hell', files: [ICON_FILES.light.logo] },
    { value: 'dark', label: 'Dunkel', files: [ICON_FILES.dark.logo] },
  ];
  return (
    <Page title="Aussehen" back="/more" withTabBar={false}>
      <Section title="Darstellung">
        <div className="grid gap-2 px-4 pb-4">
          <ToggleGroup
            type="single"
            variant="outline"
            value={a.theme}
            onValueChange={(v) => v && setThemePref(v as ThemePref)}
            className="w-full"
            aria-label="Darstellung der App"
          >
            {THEMES.map((t) => (
              <ToggleGroupItem key={t.value} value={t.value} className="h-12 flex-1 gap-2">
                {t.icon}
                {t.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground text-pretty">
            {a.theme === 'system'
              ? `Folgt der Einstellung des Geräts, gerade ${a.mode === 'dark' ? 'dunkel' : 'hell'}.`
              : 'Gilt nur auf diesem Gerät.'}
          </p>
        </div>
      </Section>

      <Section title="App-Icon">
        <div className="grid gap-3 px-4 pb-4">
          <ToggleGroup
            type="single"
            variant="outline"
            value={a.icon}
            onValueChange={(v) => v && setIconPref(v as IconPref)}
            className="w-full"
            aria-label="App-Icon"
          >
            {icons.map((i) => (
              <ToggleGroupItem key={i.value} value={i.value} className="h-auto flex-1 flex-col gap-2 py-3">
                <span className="flex h-12 items-center" aria-hidden>
                  {i.files.map((f, n) => (
                    <img
                      key={f}
                      src={f}
                      width={44}
                      height={44}
                      alt=""
                      className={n > 0 ? '-ml-4 drop-shadow-md' : 'drop-shadow-sm'}
                    />
                  ))}
                </span>
                <span className="text-sm">{i.label}</span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground text-pretty">
            Gilt für das Logo in der App und im Browser-Tab.
          </p>
          <div className="grid gap-1.5 rounded-xl bg-muted p-3 text-xs text-pretty">
            <p className="font-medium text-foreground">Icon auf dem Home-Bildschirm</p>
            <p className="text-muted-foreground">
              iOS übernimmt das Icon einmal beim Hinzufügen zum Home-Bildschirm und tauscht es danach nicht
              mehr. Für ein anderes Icon: diese Einstellung wählen, die App vom Home-Bildschirm entfernen und
              in Safari über Teilen → „Zum Home-Bildschirm“ neu hinzufügen.
            </p>
            <p className="text-muted-foreground">
              Beim Entfernen löscht iOS die Daten auf dem Gerät; nach dem Anmelden kommen sie vom Server
              zurück. Prüfe vorher unter „Daten &amp; Synchronisation“, dass alles synchronisiert ist.
            </p>
          </div>
        </div>
      </Section>
    </Page>
  );
}
