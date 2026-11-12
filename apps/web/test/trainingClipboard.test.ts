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
import { saveRecord } from '@/db/write';
import { trainingClipboardDetail } from '@/features/diary/ClipboardMenu';
import { fmt0 } from '@/lib/format';

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

  it('never copies the steps of a day', async () => {
    const d = db();
    await logTrainings(d, '2026-11-05', [training('cycling', 45)]);
    await saveRecord(d, 'exerciseEntries', {
      ...training('steps', 84),
      id: 's:2026-11-05',
      date: '2026-11-05',
      name: 'Schritte',
      loggedAt: 1,
      templateId: null,
      groupId: null,
      steps: 8432,
      distanceM: null,
    });
    const entries = await d.exerciseEntries.where('date').equals('2026-11-05').toArray();
    expect(entries).toHaveLength(2);
    expect(trainingParts(entries).map((p) => p.typeKey)).toEqual(['cycling']);
    // An older snapshot with steps in it pastes without them.
    expect(copiesOf([{ ...trainingParts(entries)[0]!, typeKey: 'steps' }], 80)).toEqual([]);
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

  it('copies a whole day: two packages and a single one paste as two new groups and one single', async () => {
    const d = db();
    await logTrainings(d, '2026-11-05', [
      training('strength', 60, { group: 'a', templateId: 'gym' }),
      training('stretching', 15, { group: 'a', templateId: 'gym' }),
      training('running', 30),
      training('cycling', 45, { group: 'b', templateId: 'bike' }),
      training('yoga', 20, { group: 'b', templateId: 'bike' }),
    ]);
    const day = await d.exerciseEntries.where('date').equals('2026-11-05').sortBy('loggedAt');
    const clip = await copyTrainingToClipboard(d, 'Training 05.11.2026', day);
    expect(trainingClipboardDetail(clip)).toBe(
      `${fmt0(clip.parts.reduce((s, p) => s + p.kcal, 0))} kcal · 3 Trainings`,
    );
    await logTrainings(d, '2026-11-06', copiesOf(clip.parts, 80));
    const pasted = await d.exerciseEntries.where('date').equals('2026-11-06').sortBy('loggedAt');
    expect(pasted.map((e) => e.typeKey)).toEqual(['strength', 'stretching', 'running', 'cycling', 'yoga']);
    const [strength, stretching, running, cycling, yoga] = pasted;
    expect(strength!.groupId).toBeTruthy();
    expect(stretching!.groupId).toBe(strength!.groupId);
    expect(running!.groupId).toBeNull();
    expect(cycling!.groupId).toBeTruthy();
    expect(yoga!.groupId).toBe(cycling!.groupId);
    expect(cycling!.groupId).not.toBe(strength!.groupId);
    expect(new Set(pasted.map((e) => e.groupId)).has(day[0]!.groupId)).toBe(false);
  });

  it('describes one package by its activities and one training by its values', async () => {
    const d = db();
    await logTrainings(d, '2026-11-05', [
      training('strength', 60, { group: 'a', templateId: 'gym' }),
      training('stretching', 15, { group: 'a', templateId: 'gym' }),
    ]);
    const day = await d.exerciseEntries.where('date').equals('2026-11-05').sortBy('loggedAt');
    expect(trainingClipboardDetail(await copyTrainingToClipboard(d, 'Gym', day))).toMatch(/· 2 Aktivitäten$/);
    expect(trainingClipboardDetail(await copyTrainingToClipboard(d, 'Kraft', day.slice(0, 1)))).toMatch(
      /^\d+ kcal · [^·]+ · Mittel$/,
    );
  });
});
