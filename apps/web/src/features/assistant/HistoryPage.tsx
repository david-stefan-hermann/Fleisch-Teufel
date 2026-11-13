/**
 * Mehr → Assistent: everything said or typed to the assistant and what became of it, newest first,
 * grouped by day (frame D1 of the mockup). This device's turns come first and work offline, with
 * "Rückgängig", "Verwerfen" for waiting ones and "Wiederholen" for failed ones; online the turns of
 * other devices are added from the server (read only). A recording plays while it is there (on the
 * device while it waits, on the server for `ASSISTANT_AUDIO_DAYS`).
 */
import { today as todayOf, type AssistantOp, type AssistantTurnRow } from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { Pause, Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useSession } from '@/app/session';
import { Page, Section } from '@/components/Page';
import { useObjectUrl } from '@/components/MealPhoto';
import { Button } from '@/components/ui/button';
import type { AssistantTurn } from '@/db/dexie';
import { useSettings } from '@/hooks/data';
import { api } from '@/lib/api';
import { fmtRelativeDay, fmtTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { discardTurn, retryTurn, undoTurn } from './queue';

/** One line of the history, from this device or from the server. */
interface Line {
  key: string;
  at: number;
  typed: boolean;
  said: string;
  did: string[];
  badges: { label: string; tone?: 'wait' }[];
  local?: AssistantTurn;
  /** Recording on the server. */
  serverAudio?: string;
}

const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** What a turn of another device did, from its operations (read only, no undo). */
export function describeOps(ops: readonly AssistantOp[], mealNames: readonly string[]): string[] {
  const meal = (m: number | null) => (m === null ? '' : `${mealNames[m] ?? ''}: `);
  return ops.flatMap((op) => {
    switch (op.kind) {
      case 'logFood':
        return [
          `${meal(op.meal)}${op.items.map((i) => `${i.food.name}, ${Math.round(i.grams)} g`).join(' · ')}`,
        ];
      case 'logEstimate':
        return [`${meal(op.meal)}${op.name} (geschätzt)`];
      case 'logQuick':
        return [`${meal(op.meal)}${op.text || 'Schnelleingabe'}`];
      case 'setWeight':
        return [`Gewicht: ${String(op.kg).replace('.', ',')} kg`];
      case 'logTraining':
        return ['Training eingetragen'];
      case 'deleteEntries':
        return ['Einträge gelöscht'];
      case 'moveEntries':
        return [`Verschoben nach ${mealNames[op.toMeal] ?? ''}`];
      case 'updateEntry':
        return [`Menge geändert: ${Math.round(op.grams)} g`];
      case 'copyEntries':
        return [`${meal(op.toMeal)}kopiert`];
      case 'logSavedMeal':
        return [`${meal(op.meal)}Meal eingetragen`];
      case 'saveMeal':
        return [`Meal gespeichert: ${op.name}`];
      case 'openCamera':
        return ['Kamera geöffnet'];
    }
  });
}

function localLine(t: AssistantTurn, serverAudio: boolean): Line {
  const waiting = t.status === 'waiting' || t.status === 'sending';
  const said = t.transcript ?? t.text ?? (t.durationMs ? `Aufnahme · ${clock(t.durationMs)}` : 'Aufnahme');
  const did: string[] = [];
  for (const a of t.applied ?? []) did.push(a.detail ?? a.text);
  if (t.question) did.unshift(`Frage: ${t.question.text}`);
  if (!t.applied?.length && !t.question && t.reply) did.push(t.reply);
  if (t.status === 'failed' && t.error) did.push(t.error);
  const badges: Line['badges'] = [];
  if (waiting) badges.push({ label: 'wartet', tone: 'wait' });
  if (t.status === 'discarded') badges.push({ label: 'verworfen' });
  if (t.undoneAt) badges.push({ label: 'rückgängig gemacht' });
  if (t.applied?.some((a) => a.guessed)) badges.push({ label: 'geschätzt' });
  if (t.status === 'failed') badges.push({ label: 'fehlgeschlagen', tone: 'wait' });
  return {
    key: t.requestId,
    at: t.createdAt,
    typed: t.source === 'text',
    said: t.transcript || t.text ? `„${said}“` : said,
    did,
    badges,
    local: t,
    ...(serverAudio && { serverAudio: t.requestId }),
  };
}

function serverLine(r: AssistantTurnRow, mealNames: readonly string[]): Line {
  const did = describeOps(r.ops, mealNames);
  if (r.question) did.unshift(`Frage: ${r.question.text}`);
  if (!r.ops.length && !r.question && r.reply) did.push(r.reply);
  const badges: Line['badges'] = [];
  if (r.outcome === 'undone') badges.push({ label: 'rückgängig gemacht' });
  if (r.ops.some((o) => (o.kind === 'logFood' && o.items.some((i) => i.guessed)) || o.kind === 'logEstimate'))
    badges.push({ label: 'geschätzt' });
  if (r.status === 'failed') badges.push({ label: 'fehlgeschlagen', tone: 'wait' });
  return {
    key: r.id,
    at: Date.parse(r.createdAt),
    typed: r.source === 'text',
    said: r.transcript ? `„${r.transcript}“` : 'Aufnahme',
    did,
    badges,
    ...(r.hasAudio && { serverAudio: r.id }),
  };
}

export function AssistantHistoryPage() {
  const { db } = useSession();
  const settings = useSettings();
  const mealNames = settings?.mealNames ?? [];
  const local = useLiveQuery(() => db.assistantTurns.orderBy('createdAt').reverse().toArray(), [db]);
  const [server, setServer] = useState<{ turns: AssistantTurnRow[]; more: boolean } | null>(null);
  const [before, setBefore] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const q = before ? `?before=${encodeURIComponent(before)}` : '';
    api<{ turns: AssistantTurnRow[]; more: boolean }>(`/api/assistant/turns${q}`, { timeoutMs: 10_000 }).then(
      (r) => {
        if (live)
          setServer((prev) => ({
            turns: [...(before ? (prev?.turns ?? []) : []), ...r.turns],
            more: r.more,
          }));
      },
      () => {
        // Offline: this device's history only.
      },
    );
    return () => {
      live = false;
    };
  }, [before]);

  if (!local)
    return (
      <Page title="Assistent" back="/more">
        {null}
      </Page>
    );
  const audioOnServer = new Set((server?.turns ?? []).filter((t) => t.hasAudio).map((t) => t.id));
  const mine = new Set(local.map((t) => t.requestId));
  const lines = [
    ...local.map((t) => localLine(t, audioOnServer.has(t.requestId))),
    ...(server?.turns ?? []).filter((t) => !mine.has(t.id)).map((t) => serverLine(t, mealNames)),
  ].sort((a, b) => b.at - a.at);
  const today = todayOf();
  const days = new Map<string, Line[]>();
  for (const l of lines) {
    const d = todayOf(new Date(l.at));
    days.set(d, [...(days.get(d) ?? []), l]);
  }

  return (
    <Page title="Assistent" back="/more">
      {lines.length === 0 && (
        <p className="px-2 py-6 text-center text-muted-foreground">Noch nichts gesagt</p>
      )}
      {[...days].map(([day, rows]) => (
        <Section key={day} title={fmtRelativeDay(day, today)}>
          <ul className="divide-y divide-border/70">
            {rows.map((l) => (
              <HistoryRow key={l.key} line={l} />
            ))}
          </ul>
        </Section>
      ))}
      {server?.more && (
        <Button variant="ghost" className="mx-auto" onClick={() => setBefore(server.turns.at(-1)!.createdAt)}>
          Ältere laden
        </Button>
      )}
    </Page>
  );
}

function HistoryRow({ line }: { line: Line }) {
  const { db } = useSession();
  const t = line.local;
  const waiting = t && (t.status === 'waiting' || t.status === 'failed');
  const action =
    t && t.undo?.length && !t.undoneAt
      ? { label: 'Rückgängig', run: () => void undoTurn(db, t.localId!) }
      : t?.status === 'failed'
        ? { label: 'Wiederholen', run: () => void retryTurn(db, t.localId!) }
        : null;
  return (
    <li className="grid grid-cols-[1fr_auto] gap-x-2.5 gap-y-0.5 py-3 pr-3.5 pl-4">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span className="tabular-nums">{fmtTime(line.at)}</span>
        {line.typed && <span>getippt</span>}
        {line.badges.map((b) => (
          <span
            key={b.label}
            className={cn(
              'rounded-full bg-muted px-1.5 py-px text-[11px] whitespace-nowrap',
              b.tone === 'wait' && 'text-warn-text',
            )}
          >
            {b.label}
          </span>
        ))}
      </div>
      <div className="col-start-2 row-span-3 row-start-1 self-center">
        <PlayButton turn={t} serverId={line.serverAudio} />
      </div>
      <div className="col-start-1 font-semibold">{line.said}</div>
      {line.did.map((d, i) => (
        <div key={i} className="col-start-1 text-sm text-muted-foreground">
          {d}
        </div>
      ))}
      {(action || waiting) && (
        <div className="col-start-1 flex gap-4 pt-0.5">
          {action && (
            <button type="button" className="text-sm font-semibold text-primary" onClick={action.run}>
              {action.label}
            </button>
          )}
          {waiting && (
            <button
              type="button"
              className="text-sm font-semibold text-primary"
              onClick={() => void discardTurn(db, t.localId!)}
            >
              Verwerfen
            </button>
          )}
        </div>
      )}
    </li>
  );
}

/** Plays the recording: the device's copy while it waits, else the server's. */
function PlayButton({ turn, serverId }: { turn?: AssistantTurn; serverId?: string }) {
  const [fetched, setFetched] = useState<Blob | null>(null);
  const [playing, setPlaying] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const localAudio = turn?.audio;
  const localType = turn?.audioType;
  const localBlob = useMemo(
    () => (localAudio ? new Blob([localAudio], { type: localType ?? 'audio/webm' }) : null),
    [localAudio, localType],
  );
  const blob = localBlob ?? fetched;
  const url = useObjectUrl(blob, turn?.audio ? `local:${turn.requestId}` : serverId);
  if (!localBlob && !serverId) return null;

  const toggle = async () => {
    const el = audio.current;
    if (playing && el && !el.paused) {
      el.pause();
      return;
    }
    if (!blob && serverId) {
      try {
        const res = await fetch(`/api/assistant/turns/${encodeURIComponent(serverId)}/audio`, {
          credentials: 'same-origin',
        });
        if (!res.ok) return;
        setFetched(await res.blob());
        // Starts once the element has the new source (`autoPlay`).
        setPlaying(true);
      } catch {
        // Offline: nothing to play.
      }
      return;
    }
    // In the tap itself (also after a blocked autoplay, which left `playing` set).
    el?.play().catch(() => setPlaying(false));
  };

  return (
    <>
      <button
        type="button"
        aria-label={playing ? 'Anhalten' : 'Aufnahme abspielen'}
        className="grid size-10 place-items-center rounded-full border border-border"
        onClick={() => void toggle()}
      >
        {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
      </button>
      {url && (
        <audio
          ref={audio}
          src={url}
          autoPlay={playing}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onError={() => setPlaying(false)}
        />
      )}
    </>
  );
}
