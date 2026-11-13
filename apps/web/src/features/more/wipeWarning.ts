import { hasUploads, isEmpty, type LocalOnly } from '@/db/localOnly';
import { fmt0 } from '@/lib/format';

const count = (n: number, one: string, many: string) => `${fmt0(n)} ${n === 1 ? one : many}`;

function list(parts: [number, string, string][]): string {
  return parts
    .filter(([n]) => n > 0)
    .map((p) => count(...p))
    .join(', ');
}

/** The text of "Gerätedaten löschen?": what is lost, or that everything stays on the server. */
export function wipeWarning(l: LocalOnly | undefined): string {
  if (!l || isEmpty(l))
    return 'Alle Daten bleiben auf dem Server und kommen nach der nächsten Anmeldung zurück.';
  const out: string[] = [];
  if (hasUploads(l))
    out.push(
      `Noch nicht hochgeladen: ${list([
        [l.changes, 'Änderung', 'Änderungen'],
        [l.photos, 'Foto', 'Fotos'],
      ])}. Vor dem Löschen wird noch einmal versucht, sie hochzuladen; gelingt das nicht, gehen sie verloren.`,
    );
  if (l.analyses + l.drafts + l.utterances > 0)
    out.push(
      `Nur auf diesem Gerät, gehen verloren: ${list([
        [l.analyses, 'Analyse', 'Analysen'],
        [l.drafts, 'Entwurf', 'Entwürfe'],
        [l.utterances, 'Aufnahme', 'Aufnahmen'],
      ])}.`,
    );
  return out.join(' ');
}
