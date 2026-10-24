import { AppLogo } from '@/components/AppLogo';
import { Page, Section } from '@/components/Page';
import { useSessionContext } from '@/app/session';

export function AboutPage() {
  const { serverInfo } = useSessionContext();
  return (
    <Page title="Über" back="/more" withTabBar={false}>
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <AppLogo size={64} />
        <h2 className="text-xl font-bold" translate="no">
          Fleisch-Teufel
        </h2>
        <p className="text-sm text-muted-foreground">
          App {__APP_VERSION__}
          {serverInfo && ` · Server ${serverInfo.version} · BLS ${serverInfo.blsVersion.split('+')[0]}`}
        </p>
        <p className="text-sm text-muted-foreground text-pretty">
          Selbst gehostetes Ernährungstagebuch, offline-fähig. Open Source (MIT-Lizenz).
        </p>
      </div>
      <Section title="Datenquellen">
        <div className="grid gap-4 px-4 pb-4 text-sm text-pretty">
          <div>
            <h3 className="font-medium">Bundeslebensmittelschlüssel (BLS) 4.0</h3>
            <p className="text-muted-foreground">
              Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0. Karlsruhe. 7.140
              Lebensmittel mit 138 Nährstoffen, kostenfrei bereitgestellt.{' '}
              <a
                href="https://www.blsdb.de"
                className="text-primary underline"
                rel="noreferrer"
                target="_blank"
              >
                blsdb.de
              </a>
            </p>
          </div>
          <div>
            <h3 className="font-medium">Open Food Facts</h3>
            <p className="text-muted-foreground">
              Produktdaten © Open-Food-Facts-Mitwirkende, lizenziert unter der{' '}
              <a
                href="https://opendatacommons.org/licenses/odbl/1-0/"
                className="text-primary underline"
                rel="noreferrer"
                target="_blank"
              >
                Open Database License (ODbL)
              </a>
              . Angaben ohne Gewähr.{' '}
              <a
                href="https://world.openfoodfacts.org"
                className="text-primary underline"
                rel="noreferrer"
                target="_blank"
              >
                openfoodfacts.org
              </a>
            </p>
          </div>
          <div>
            <h3 className="font-medium">MET-Werte für Training</h3>
            <p className="text-muted-foreground">
              Compendium of Physical Activities: Ainsworth BE et al. (2011), Med Sci Sports Exerc
              43(8):1575-1581; Herrmann SD et al. (2024), J Sport Health Sci 13(1):6-12. Werte gerundet.
            </p>
          </div>
          <div>
            <h3 className="font-medium">Formeln & Empfehlungen</h3>
            <p className="text-muted-foreground">
              Grundumsatz nach Mifflin-St Jeor (1990). Nährstoff-Orientierungswerte der Deutschen Gesellschaft
              für Ernährung (DGE): Ballaststoffe ≥ 30 g, Salz ≤ 6 g, gesättigte Fettsäuren ≤ 10 % der Energie.
              Der Zuckerwert ist eine Orientierung für den Gesamtzucker: die DGE/WHO-Grenze von 10 % gilt für
              freie Zucker, die Datenbanken weisen aber nur den Gesamtzucker aus (mit Milch- und
              Fruchtzucker). 7700 kcal ≈ 1 kg Körpergewicht (Näherung).
            </p>
          </div>
          <div>
            <h3 className="font-medium">KI-Foto-Analyse</h3>
            <p className="text-muted-foreground">
              Claude von Anthropic erkennt Lebensmittel und schätzt Mengen. Die Fotos liegen auf deinem Gerät
              und deinem eigenen Server (für die anderen Geräte); an Anthropic gehen sie nur zur Analyse und
              werden dort nicht gespeichert. Nährwerte kommen aus BLS, Open Food Facts und deinen eigenen
              Lebensmitteln; nur wenn nichts passt, schätzt die KI selbst, und das steht dann dran
              („KI-Schätzung“).
            </p>
          </div>
        </div>
      </Section>
      <p className="text-center text-xs text-muted-foreground">
        Kein Medizinprodukt. Bei gesundheitlichen Fragen ärztlichen Rat einholen.
      </p>
    </Page>
  );
}
