/**
 * The assistant's tools (from the spike, `assistant_test.py` / `assistant_test2.py`). Read tools run on
 * the server; write tools are only checked and collected as operations for the device.
 */
import type Anthropic from '@anthropic-ai/sdk';

type Tool = Anthropic.Beta.BetaTool;
type Props = Record<string, unknown>;

const obj = (properties: Props, required: string[] = []) => ({
  type: 'object' as const,
  properties,
  required,
});
const str = { type: 'string' };
const num = { type: 'number' };
const ids = { type: 'array', items: str };

/**
 * The tool list. `mealNames` are the person's meal names (they can be renamed), so the list is
 * stable per person and stays in the prompt cache.
 */
export function assistantTools(mealNames: readonly string[]): Tool[] {
  const meal = { type: 'string', enum: [...mealNames] };
  const date = { type: 'string', description: 'YYYY-MM-DD' };
  return [
    {
      name: 'search_foods',
      description:
        'Search the food database, the person\'s own foods and saved meals. Returns ids, kcal and macros per 100 g, portions and the last logged amount ("zuletzt").',
      input_schema: obj({ query: str }, ['query']),
    },
    {
      name: 'search_trainings',
      description: 'Search saved trainings and sports. Returns ids/keys and the last logged values.',
      input_schema: obj({ query: str }, ['query']),
    },
    {
      name: 'get_day',
      description:
        'Read entries, trainings and weight of a day other than today and yesterday (those are in the prompt).',
      input_schema: obj({ date }, ['date']),
    },
    {
      name: 'log_food',
      description:
        'Log foods into a diary meal. Several items of one dish share groupName. Set guessed on an item whose amount you had to assume. portion: the portion label from the search the amount refers to, if any.',
      input_schema: obj(
        {
          date,
          meal,
          items: {
            type: 'array',
            items: obj({ foodId: str, grams: num, portion: str, guessed: { type: 'boolean' } }, [
              'foodId',
              'grams',
            ]),
          },
          groupName: str,
        },
        ['date', 'items'],
      ),
    },
    {
      name: 'log_estimate',
      description:
        'Log a food or dish the search does not have, with your own estimate for the eaten amount. The app marks it as estimated.',
      input_schema: obj(
        { date, meal, name: str, grams: num, kcal: num, proteinG: num, carbsG: num, fatG: num },
        ['date', 'name', 'grams', 'kcal', 'proteinG', 'carbsG', 'fatG'],
      ),
    },
    {
      name: 'log_saved_meal',
      description: 'Log a saved meal by id (from search_foods).',
      input_schema: obj({ mealId: str, date, meal }, ['mealId', 'date']),
    },
    {
      name: 'log_quick',
      description: 'Log plain values without a food (quick entry).',
      input_schema: obj({ date, meal, kcal: num, proteinG: num, carbsG: num, fatG: num, text: str }, [
        'date',
        'kcal',
      ]),
    },
    {
      name: 'update_entry',
      description: 'Change the amount of a diary entry.',
      input_schema: obj({ entryId: str, grams: num }, ['entryId', 'grams']),
    },
    {
      name: 'move_entries',
      description: 'Move diary entries to another meal and/or day.',
      input_schema: obj({ entryIds: ids, toDate: date, toMeal: meal }, ['entryIds', 'toDate', 'toMeal']),
    },
    {
      name: 'copy_entries',
      description: 'Log copies of existing diary entries on a day and meal (e.g. the same as yesterday).',
      input_schema: obj({ entryIds: ids, toDate: date, toMeal: meal }, ['entryIds', 'toDate']),
    },
    {
      name: 'delete_entries',
      description: 'Delete diary entries (they go to the trash, the person can undo).',
      input_schema: obj({ entryIds: ids }, ['entryIds']),
    },
    {
      name: 'save_meal',
      description:
        'Save diary entries as a reusable meal with a name. The entries stay in the diary and are attached to the new meal.',
      input_schema: obj({ name: str, entryIds: ids }, ['name', 'entryIds']),
    },
    {
      name: 'set_weight',
      description: 'Log or correct the body weight of a day.',
      input_schema: obj({ date, kg: num }, ['date', 'kg']),
    },
    {
      name: 'log_training',
      description:
        'Log trainings: a sport by key with minutes and intensity, or a saved training by id (its saved activities).',
      input_schema: obj(
        {
          date,
          items: {
            type: 'array',
            items: obj({
              sportKey: str,
              savedTrainingId: str,
              minutes: num,
              intensity: { type: 'string', enum: ['light', 'moderate', 'vigorous'] },
            }),
          },
        },
        ['date', 'items'],
      ),
    },
    {
      name: 'open_camera',
      description: 'Open the camera for a photo analysis of a meal. The hint goes to the analysis.',
      input_schema: obj({ date, meal, hint: str }, ['date', 'hint']),
    },
    {
      name: 'ask',
      description:
        'Ask the person one question when it is really needed. Give two to four short answer options when they exist. Ends your turn.',
      input_schema: obj({ question: str, options: { type: 'array', items: str } }, ['question']),
    },
  ];
}

export const READ_TOOLS = new Set(['search_foods', 'search_trainings', 'get_day']);
