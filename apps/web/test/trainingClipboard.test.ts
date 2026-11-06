import { trainingKcal, uuidv7 } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import {
  copiesOf,
  copyTrainingToClipboard,
  foodClipboard,
  readClipboard,
  trainingClipboard,
  trainingParts,
} from '@/db/clipboard';
import { UserDb } from '@/db/dexie';
import { logTrainings } from '@/db/entries';

const db = () => new UserDb(`t-${uuidv7()}`);

const training = (
  typeKey: string,
  minutes: number,
  extra: { kcal?: number; group?: string; templateId?: string } = {},
) => ({
  typeKey,
  name: typeKey,
  minutes,
  intensity: 'moderate' as const,
  met: 6,
  weightKg: 80,
  kcal: extra.kcal ?? trainingKcal(6, 80, minutes),
  note: null,
  ...(extra.group && { group: extra.group, templateId: extra.templateId ?? null }),
});

describe('training clipboard (copy by swiping right, paste into the training card, "Wie gestern")', () => {
  it('computes kcal again with the weight of the target day, typed kcal stay', async () => {
    const d = db();
    await logTrainings(d, '2026-11-05', [training('cycling', 45), training('running', 30, { kcal: 520 })]);
    const entries = await d.exerciseEntries.where('date').equals('2026-11-05').sortBy('loggedAt');
    const parts = trainingParts(entries);
    expect(parts.map((p) => [p.typeKey, p.auto])).toEqual([
      ['cycling', true],
      ['running', false],
    ]);
    const copies = copiesOf(parts, 70);
    expect(copies[0]).toMatchObject({ weightKg: 70, kcal: trainingKcal(6, 70, 45) });
    expect(copies[1]).toMatchObject({ weightKg: 70, kcal: 520 });
  });

  it('pastes a package as a new group with its saved training', async () => {
    const d = db();
    await logTrainings(d, '2026-11-05', [
      training('strength', 60, { group: 'a', templateId: 'gym' }),
      training('stretching', 15, { group: 'a', templateId: 'gym' }),
    ]);
    const entries = await d.exerciseEntries.where('date').equals('2026-11-05').sortBy('loggedAt');
    await copyTrainingToClipboard(d, 'Gym-Besuch', entries);
    const clip = trainingClipboard(await readClipboard(d))!;
    expect(clip).toMatchObject({ kind: 'training', name: 'Gym-Besuch' });
    // Meals never paste trainings.
    expect(foodClipboard(clip)).toBeNull();
    await logTrainings(d, '2026-11-06', copiesOf(clip.parts, 80));
    const pasted = await d.exerciseEntries.where('date').equals('2026-11-06').sortBy('loggedAt');
    expect(pasted.map((e) => e.typeKey)).toEqual(['strength', 'stretching']);
    expect(pasted[0]!.groupId).toBeTruthy();
    expect(pasted[1]!.groupId).toBe(pasted[0]!.groupId);
    expect(pasted[0]!.groupId).not.toBe(entries[0]!.groupId);
    expect(pasted.map((e) => e.templateId)).toEqual(['gym', 'gym']);
    // The clipboard stays filled after pasting.
    expect(trainingClipboard(await readClipboard(d))).not.toBeNull();
  });
});
