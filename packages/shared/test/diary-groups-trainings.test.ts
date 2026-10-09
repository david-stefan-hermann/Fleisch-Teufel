import { describe, expect, it } from 'vitest';
import { groupDiaryEntries } from '../src/diary.js';
import { recentTrainings } from '../src/exercise.js';
import { exerciseEntrySchema, foodEntrySchema } from '../src/schemas.js';

const entry = (id: string, loggedAt: number, kcal: number, groupId: string | null = null) => ({
  id,
  updatedAt: 1,
  deleted: false,
  date: '2026-10-07',
  meal: 1,
  loggedAt,
  foodId: null,
  source: 'quick' as const,
  name: id,
  brand: null,
  grams: null,
  portionLabel: null,
  portionGrams: null,
  quantity: 1,
  per100: null,
  nutrients: { ENERCC: kcal, PROT625: 1 },
  mealId: groupId ? 'meal-1' : null,
  aiAnalysisId: null,
  groupId,
  groupName: null as string | null,
  photoId: null as string | null,
});

describe('groupDiaryEntries', () => {
  it('collapses entries of one logging action into a group at the position of its first entry', () => {
    const rows = groupDiaryEntries([
      entry('apple', 1, 50),
      entry('pasta', 2, 400, 'g1'),
      entry('sauce', 3, 200, 'g1'),
      entry('cheese', 4, 80, 'g1'),
      entry('coffee', 5, 5),
    ]);
    expect(rows.map((r) => (r.kind === 'entry' ? r.entry.id : `group:${r.groupId}`))).toEqual([
      'apple',
      'group:g1',
      'coffee',
    ]);
    const group = rows[1]!;
    expect(group.kind === 'group' && group.entries.map((e) => e.id)).toEqual(['pasta', 'sauce', 'cheese']);
    expect(group.kind === 'group' && group.nutrients).toEqual({ ENERCC: 680, PROT625: 3 });
    expect(group.kind === 'group' && group.mealId).toBe('meal-1');
    expect(group.kind === 'group' && group.groupName).toBeNull();
  });

  it('carries the name of a group without a saved meal', () => {
    const named = (id: string, loggedAt: number) => ({
      ...entry(id, loggedAt, 100, 'g1'),
      mealId: null,
      groupName: 'Mittag vom Foto',
    });
    const [row] = groupDiaryEntries([named('rice', 1), named('chicken', 2)]);
    expect(row).toMatchObject({ kind: 'group', mealId: null, groupName: 'Mittag vom Foto' });
  });

  it('keeps two loggings of the same meal apart and shows leftovers of a group as single entries', () => {
    const rows = groupDiaryEntries([
      entry('a1', 1, 100, 'g1'),
      entry('b1', 2, 100, 'g1'),
      entry('a2', 3, 100, 'g2'),
      entry('b2', 4, 100, 'g2'),
      entry('only', 5, 100, 'g3'),
    ]);
    expect(rows.map((r) => r.kind)).toEqual(['group', 'group', 'entry']);
  });

  it('leaves entries from older app versions (no groupId) untouched', () => {
    const { groupId: _omit, ...old } = entry('old', 1, 10);
    const rows = groupDiaryEntries([old as never]);
    expect(rows).toEqual([{ kind: 'entry', entry: old }]);
  });
});

describe('recentTrainings', () => {
  const t = (
    loggedAt: number,
    typeKey: string,
    minutes = 30,
    note: string | null = null,
    deleted = false,
  ) => ({
    typeKey,
    name: typeKey,
    minutes,
    intensity: 'moderate' as const,
    note,
    loggedAt,
    deleted,
  });

  it('returns the newest distinct setups, at most five', () => {
    const list = recentTrainings([
      t(1, 'a'),
      t(2, 'b'),
      t(3, 'a'),
      t(4, 'c'),
      t(5, 'd'),
      t(6, 'e'),
      t(7, 'f'),
      t(8, 'a', 45),
      t(9, 'x', 30, null, true),
    ]);
    expect(list.map((e) => `${e.typeKey}${e.minutes}`)).toEqual(['a45', 'f30', 'e30', 'd30', 'c30']);
  });

  it('treats a different note as a different training', () => {
    const list = recentTrainings([
      t(1, 'gym', 60, 'Beine'),
      t(2, 'gym', 60, 'Oberkörper'),
      t(3, 'gym', 60, ' Beine '),
    ]);
    expect(list.map((e) => e.note)).toEqual([' Beine ', 'Oberkörper']);
  });
});

describe('schema defaults for older clients', () => {
  it('fills groupId, groupName, photoId and note with null when missing', () => {
    const { groupId: _omit, groupName: _name, photoId: _photo, ...old } = entry('x', 1, 10);
    expect(foodEntrySchema.parse(old).groupId).toBeNull();
    expect(foodEntrySchema.parse(old).groupName).toBeNull();
    expect(foodEntrySchema.parse(old).photoId).toBeNull();
    expect(foodEntrySchema.parse({ ...old, groupName: '  Bowl ' }).groupName).toBe('Bowl');
    expect(() => foodEntrySchema.parse({ ...old, groupName: 'x'.repeat(121) })).toThrow();
    const ex = exerciseEntrySchema.parse({
      id: 'e',
      updatedAt: 1,
      deleted: false,
      date: '2026-10-07',
      typeKey: 'running',
      name: 'Laufen',
      minutes: 30,
      intensity: 'moderate',
      met: 9.8,
      weightKg: 80,
      kcal: 300,
      loggedAt: 1,
    });
    expect(ex.note).toBeNull();
  });
});
