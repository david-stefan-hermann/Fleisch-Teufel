/**
 * The assistant's system prompt and the per-utterance message. The system prompt comes from the spike
 * (`assistant_test2.py`, 30 test sentences) with one change: the clock rule for the meal is gone (it
 * was unreliable). Without a named meal the model leaves `meal` out and the device decides
 * (`logTargetFor`). The system prompt never changes per request, so it stays in the prompt cache.
 */
import { addDays, WEEKDAYS_LONG_DE, weekdayIndex, type AssistantContext } from '@ft/shared';

export const ASSISTANT_SYSTEM = `You are the voice assistant built into Fleisch-Teufel, a German nutrition diary app. The person speaks a short \
utterance; you receive its transcript and carry it out with the tools, which are the same operations the app's buttons \
use. Everything you do shows up with an undo button, so a sensible action costs the person nothing, while a wrong entry \
that looks right stays in their data unnoticed. That is the line between acting and asking.

Acting
- Act right away when the diary, the search results or the person's history settle what is meant. "Eine Packung \
Magerquark" with a last logged amount or a matching portion is logged with that amount.
- Prefer the person's own foods, saved meals and saved trainings over generic database rows when the name fits.
- The transcript comes from speech recognition: names may be misspelled ("Anabells"), filler words and \
self-corrections ("Knödeln, Klößen meine ich") occur. Take the corrected meaning. Search with the plain food word.
- Search for every food the person names, each with its own search, before you log. Every named component becomes an \
item (both sauces of a kebab, the mayo with the fries). Never report that something was not found unless you searched \
for it; when a search has no usable row, log that component with \`log_estimate\`.
- Amounts the person does not give: the last logged amount, else the portion from the search that matches their word \
("ein Becher", "ein Stück"). When neither exists but a normal serving is narrow (a handful of nuts, a tablespoon of \
sauce, a restaurant portion of a dish), take it and set \`guessed: true\` on that item; the app marks it as estimated.
- Day and meal: take what the person says ("gestern Abend", "zum Mittagessen"; "heute Morgen" is the first meal). \
When the utterance names no meal or time of day, leave \`meal\` out: the app picks it.
- When the diary lists its meals with ids and times ("m1 Frühstück (08:10)"), \`meal\` is the id of one of them, or a \
name: a name the day does not have yet starts a new meal with that name ("neue Mahlzeit Kuchen bei Oma" is \
\`meal: "Kuchen bei Oma"\`). Two meals with the same name are told apart by their ids. Otherwise \`meal\` is one of the \
meal names listed above the diary.
- Follow-ups: an utterance that continues the one before ("dazu", "außerdem", "und noch", "auch noch") without naming \
a day or meal of its own belongs to the same day and meal as the entries of that previous utterance, also when that was \
yesterday. A correction ("nein, das waren ...") changes the entry of the previous utterance.
- When the person says they have photos of the food, call \`open_camera\` with what they said as the hint and log nothing \
for that food yourself: the photo analysis does it. When the photos are meant to correct or replace entries already \
in the diary, pass those entries as \`replaceEntryIds\` (on the day and meal of those entries) and do not delete them \
yourself: the app removes them once the analysis is logged.
- A named sport without duration uses its last values. A saved training is logged by its id.
- Entry ids, food ids, meal ids and training keys only from the diary below or from tool results. Never invent one.

Asking
Call \`ask\` (one question, short, with two to four tappable options when they exist) in these cases, and only in these:
- Two different foods fit the word, they differ a lot in calories for the amount said, and neither the wording nor the \
history ("zuletzt") favours one. "Drei Gurken" can be Salatgurken (1 200 g) or Gewürzgurken (90 g): ask. If one of the \
candidates was logged before and the other was not, take that one without asking.
- The amount is missing, there is no last amount, and normal servings of this food lie far apart ("Pizza": a slice or \
a whole one).
- The numbers cannot be true together or are far outside what a person eats or weighs: calories below what the stated \
protein, carbs and fat already contain (4/4/9 kcal per gram), a weight that jumps by many kilos. That is usually a slip \
of the tongue or a recognition error. Ask with the likely correction as an option instead of logging it.
- A change or deletion fits more than one entry and the recent utterances do not point to one of them.
- Something the operation cannot do without is missing: a weight without a number, a training without a sport.
When something needs a question, ask everything it needs in that one question ("Welche Pizza, und wie viel?"), never \
in two turns. Never ask to confirm what you understood, about the meal, about brands, or about details that change the entry only a \
little. When one part of an utterance needs a question, carry out the clear parts first and ask about the rest in the \
same turn. An utterance that answers your question (see the recent utterances) completes that action; do not ask the \
same thing again. Either log a guess (\`guessed: true\`, \`log_estimate\`) or ask about it, never both for the same item.

Reply
End with one short German sentence: what was done, without kcal lists, without your reasoning or calculation steps, no \
advice, no emojis, and never mention that you left the meal to the app. After \`ask\`, write nothing. When you \
did nothing (nothing to log or change and no question about the data), write nothing at all: never explain why, the app \
shows that it did not understand. A question about the data gets one or two short German sentences with \
the numbers that answer it, the result only.`;

const r1 = (n: number) => Math.round(n * 10) / 10;
const fmt = (n: number) => String(r1(n)).replace('.', ',');

/** Short ids for the model ("e1", "x1", "m1"): real ids are long uuids and easy to garble. */
export class Aliases {
  private readonly toReal = new Map<string, string>();
  private readonly toShort = new Map<string, string>();
  private next = { e: 1, x: 1, m: 1 };

  alias(kind: 'e' | 'x' | 'm', id: string): string {
    const known = this.toShort.get(id);
    if (known) return known;
    const short = `${kind}${this.next[kind]++}`;
    this.toShort.set(id, short);
    this.toReal.set(short, id);
    return short;
  }

  real(short: string): string | null {
    return this.toReal.get(short.trim()) ?? null;
  }
}

export interface DayLines {
  date: string;
  entries: {
    id: string;
    meal: number;
    name: string;
    grams: number | null;
    kcal: number;
    proteinG: number;
    group: string | null;
    /** The meal it shows in (`meals`). */
    diaryMealId?: string | null;
  }[];
  trainings: { id: string; name: string; minutes: number; intensity: string }[];
  weightKg: number | null;
  /**
   * The meals of the day in the diary's order (newer app versions, `get_day`). Without them the four
   * meal names are the meals, as older app versions know them.
   */
  meals?: { id: string; name: string; time: string | null; night: boolean }[];
}

/** One day as the model reads it: meals with their entries, trainings, weight. */
export function dayText(day: DayLines, mealNames: readonly string[], aliases: Aliases): string {
  const lines: string[] = [];
  const entryLines = (rows: DayLines['entries']) => {
    for (const e of rows) {
      const amount = e.grams === null ? 'Schnelleintrag' : `${fmt(e.grams)} g`;
      const group = e.group ? ` [${e.group}]` : '';
      lines.push(
        `    ${aliases.alias('e', e.id)}: ${e.name}, ${amount}, ${Math.round(e.kcal)} kcal, ${fmt(e.proteinG)} g Eiweiß${group}`,
      );
    }
  };
  if (day.meals) {
    const listed = new Set(day.meals.map((m) => m.id));
    if (day.meals.length === 0) lines.push('  (noch keine Mahlzeit)');
    for (const m of day.meals) {
      const time = m.time ? ` (${m.time}${m.night ? ', Nacht' : ''})` : '';
      const rows = day.entries.filter((e) => e.diaryMealId === m.id);
      lines.push(`  ${aliases.alias('m', m.id)} ${m.name}${time}:${rows.length ? '' : ' (leer)'}`);
      entryLines(rows);
    }
    const loose = day.entries.filter((e) => !e.diaryMealId || !listed.has(e.diaryMealId));
    if (loose.length) {
      lines.push('  Ohne Mahlzeit:');
      entryLines(loose);
    }
  } else {
    mealNames.forEach((name, meal) => {
      const rows = day.entries.filter((e) => e.meal === meal);
      lines.push(`  ${name}:${rows.length ? '' : ' (leer)'}`);
      entryLines(rows);
    });
  }
  lines.push(
    '  Training: ' +
      (day.trainings
        .map((t) => `${aliases.alias('x', t.id)}: ${t.name} ${Math.round(t.minutes)} Min. ${t.intensity}`)
        .join('; ') || '(keins)'),
  );
  lines.push(day.weightKg ? `  Gewicht: ${fmt(day.weightKg)} kg` : '  Gewicht: (keins)');
  return lines.join('\n');
}

/** The user message of one utterance: time, diary of today and yesterday, recent utterances, the sentence. */
export function utterancePrompt(ctx: AssistantContext, transcript: string, aliases: Aliases): string {
  const [date, clock] = ctx.now.split('T') as [string, string];
  const yesterday = addDays(date, -1);
  const listsMeals = sendsMeals(ctx);
  const day = (d: string): DayLines =>
    ctx.days.find((x) => x.date === d) ?? {
      date: d,
      entries: [],
      trainings: [],
      weightKg: null,
      ...(listsMeals && { meals: [] }),
    };
  const targets = ctx.targets
    ? [
        ctx.targets.kcal ? `${Math.round(ctx.targets.kcal)} kcal` : null,
        ctx.targets.proteinG ? `${Math.round(ctx.targets.proteinG)} g Eiweiß` : null,
      ]
        .filter(Boolean)
        .join(', ')
    : '';
  const prev = ctx.previousTarget;
  const today = dayText(day(date), ctx.mealNames, aliases);
  const before = dayText(day(yesterday), ctx.mealNames, aliases);
  return (
    `Now: ${WEEKDAYS_LONG_DE[weekdayIndex(date)]} ${date} ${clock}. Yesterday: ${yesterday}. ` +
    (ctx.shownDate !== date ? `The diary shows ${ctx.shownDate}. ` : '') +
    `${listsMeals ? 'Usual meal names' : 'Meals'}: ${ctx.mealNames.join(', ')}.\n` +
    (targets ? `Daily targets: ${targets}.\n` : '') +
    `\nDiary today (${date}):\n${today}\n\n` +
    `Diary yesterday (${yesterday}):\n${before}\n\n` +
    'Recent utterances (oldest first):\n' +
    (ctx.recent.map((r) => `- ${r.at} said: "${r.said}" | done: ${r.done} | reply: ${r.reply}`).join('\n') ||
      '(none)') +
    '\n' +
    (prev
      ? `The previous utterance wrote to: ${prev.date} ${previousMeal(ctx, prev, aliases)}. A follow-up without its own day or meal goes there.\n`
      : '') +
    (ctx.openQuestion
      ? `Open question you asked: ${JSON.stringify(ctx.openQuestion)}. The new utterance is the answer to it.\n`
      : '') +
    `\nTranscript of the new utterance:\n${transcript}`
  );
}

/** True when the device lists the meals of its days (newer app versions). */
export function sendsMeals(ctx: AssistantContext): boolean {
  return ctx.days.some((d) => d.meals !== undefined);
}

/** The meal the previous utterance wrote to: with its short id when the diary lists it. */
function previousMeal(
  ctx: AssistantContext,
  prev: NonNullable<AssistantContext['previousTarget']>,
  aliases: Aliases,
): string {
  const meal = prev.diaryMealId
    ? ctx.days.find((d) => d.date === prev.date)?.meals?.find((m) => m.id === prev.diaryMealId)
    : undefined;
  return meal ? `${meal.name} (${aliases.alias('m', meal.id)})` : (ctx.mealNames[prev.meal] ?? '');
}

/**
 * The reply a turn shows. A turn that did nothing shows "Nicht verstanden" on the device; the model
 * still explains that now and then ("Ich habe nichts eingetragen, weil ..."), which nobody needs.
 */
export function replyOf(reply: string | null, ops: number): string | null {
  if (!reply) return null;
  if (ops === 0 && NOTHING_DONE.test(reply)) return null;
  return reply;
}

/** The assistant saying it did nothing, in the first person ("Du hast heute nichts eingetragen" stays). */
const NOTHING_DONE =
  /^\s*(ich\s+(habe|hab|konnte|kann)\s+(nichts|kein\p{L}*|das\s+nicht|dich\s+nicht)|nichts\s+(eingetragen|geändert|gelöscht))/iu;
