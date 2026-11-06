import {
  get,
  groupDiaryEntries,
  groupTrainingEntries,
  MEAL_COUNT,
  N,
  type DaySummary,
  type ExerciseEntry,
  type FoodEntry,
  type ISODate,
} from '@ft/shared';
import { Utensils } from 'lucide-react';
import { AppLogo } from '@/components/AppLogo';
import { Section } from '@/components/Page';
import { fmt0, fmtDayLongYear, fmtIngredients } from '@/lib/format';
import { CalorieOverview } from '../CalorieCard';
import { trainingTitle } from '@/features/exercise/training';
import { ExerciseRowBody, TrainingGroupRowBody, trainingGroupTitle } from '../ExerciseCard';
import { EntryRowBody, GroupRowBody } from '../MealCard';

export interface ShareParts {
  food: boolean;
  training: boolean;
  note: boolean;
}

export interface DayShareData {
  date: ISODate;
  summary: DaySummary;
  exerciseCredited: boolean;
  mealNames: string[];
  entries: FoodEntry[];
  exercises: ExerciseEntry[];
  note: string;
  /** Name and photo of the saved meals the groups come from. */
  savedMeals: Map<string, { name: string; photoId: string | null }>;
  /** Names of the saved trainings the trainings were logged from. */
  savedTrainings: Map<string, string>;
  /** Image sources (data URLs) by photo id; a missing one shows the placeholder. */
  photos: Map<string, string>;
  parts: ShareParts;
}

const ROW = 'flex min-h-14 items-center gap-3 px-4 py-2';

/**
 * The shared day as one long picture, like a screenshot of the diary without what only matters in
 * the app: the date instead of header and calendar, the calorie overview (closed, no button), the
 * meals with entries (groups closed), trainings and the note when chosen, a small footer. Only props,
 * no router, no live queries: it is rendered into its own root and rasterized (`renderDayImage`).
 */
export function DayShareImage({ data }: { data: DayShareData }) {
  const { date, summary, entries, exercises, note, parts } = data;
  const trainingKcal = exercises.reduce((s, e) => s + e.kcal, 0);
  return (
    <div className="w-[390px] bg-background p-4 text-foreground">
      <h1 className="mt-1 mb-3.5 text-xl font-semibold tracking-tight">{fmtDayLongYear(date)}</h1>
      {parts.food && (
        <>
          <section className="mb-4 rounded-2xl border border-border/70 bg-card p-4 shadow-[0_1px_2px_rgb(0_0_0/0.04)]">
            <CalorieOverview summary={summary} exerciseCredited={data.exerciseCredited} />
          </section>
          {Array.from({ length: MEAL_COUNT }, (_, m) => {
            const list = entries.filter((e) => e.meal === m);
            if (list.length === 0) return null;
            return (
              <MealSection
                key={m}
                name={data.mealNames[m] ?? `Mahlzeit ${m + 1}`}
                kcal={get(summary.perMeal[m] ?? {}, N.kcal)}
                entries={list}
                data={data}
              />
            );
          })}
        </>
      )}
      {parts.training && exercises.length > 0 && (
        <Section title={<Title name="Training" kcal={trainingKcal} />}>
          <ul className="divide-y divide-border/70">
            {groupTrainingEntries(exercises).map((row) =>
              row.kind === 'entry' ? (
                <li key={row.entry.id} className={ROW}>
                  <ExerciseRowBody entry={row.entry} {...trainingTitle(row.entry, data.savedTrainings)} />
                </li>
              ) : (
                <li key={row.groupId} className={ROW}>
                  <TrainingGroupRowBody
                    title={trainingGroupTitle(row.templateId, row.entries, data.savedTrainings)}
                    entries={row.entries}
                  />
                </li>
              ),
            )}
          </ul>
        </Section>
      )}
      {parts.note && note.trim() && (
        <Section title="Notiz">
          <p className="px-4 pb-4 text-[0.9375rem] whitespace-pre-wrap">{note.trim()}</p>
        </Section>
      )}
      <div className="flex items-center justify-center gap-1.5 pb-0.5 text-xs text-muted-foreground">
        <AppLogo size={20} />
        Fleisch-Teufel
      </div>
    </div>
  );
}

function Title({ name, kcal }: { name: string; kcal: number }) {
  return (
    <span className="flex items-baseline gap-2">
      {name}
      {kcal > 0 && (
        <span className="tabular text-sm font-normal text-muted-foreground">{fmt0(kcal)} kcal</span>
      )}
    </span>
  );
}

function MealSection({
  name,
  kcal,
  entries,
  data,
}: {
  name: string;
  kcal: number;
  entries: FoodEntry[];
  data: DayShareData;
}) {
  return (
    <Section title={<Title name={name} kcal={kcal} />}>
      <ul className="divide-y divide-border/70">
        {groupDiaryEntries(entries).map((row) => {
          if (row.kind === 'entry') {
            return (
              <li key={row.entry.id} className={ROW}>
                <EntryRowBody entry={row.entry} />
              </li>
            );
          }
          const saved = row.mealId ? data.savedMeals.get(row.mealId) : undefined;
          const photoId = row.entries[0]?.photoId || saved?.photoId || null;
          const src = photoId ? data.photos.get(photoId) : undefined;
          return (
            <li key={row.groupId} className={ROW}>
              <GroupRowBody
                photo={
                  photoId &&
                  (src ? (
                    <img src={src} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Utensils className="size-4 text-muted-foreground" aria-hidden />
                    </div>
                  ))
                }
                fromPhoto={row.entries.some((e) => e.source === 'ai')}
                name={<span className="truncate">{row.groupName || saved?.name || 'Meal'}</span>}
                detail={
                  <div className="text-xs text-muted-foreground">{fmtIngredients(row.entries.length)}</div>
                }
                nutrients={row.nutrients}
              />
            </li>
          );
        })}
      </ul>
    </Section>
  );
}
