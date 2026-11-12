import { uuidv7, type DailyRow } from '@ft/shared';
import { describe, expect, it } from 'vitest';
import { UserDb } from '@/db/dexie';
import { earliestDate } from '@/db/earliest';
import { buildChart } from '@/features/reports/chartData';
import { dailyCsv, sourceLabel } from '@/features/reports/export';
import { fmt0, fmt1, fmt2, fmtFixed } from '@/lib/format';

describe('formatting never shows "-0"', () => {
  it('prints a negative zero and values that round to zero as 0', () => {
    expect(fmt0(-0)).toBe('0');
    expect(fmt0(-0.4)).toBe('0');
    expect(fmt1(-0.04)).toBe('0');
    expect(fmt2(-0.004)).toBe('0');
    expect(fmt2(Math.round(-0.004 * 100) / 100)).toBe('0');
    expect(fmtFixed(-0.001, 1)).toBe('0,0');
    // Real negative values keep their sign.
    expect(fmt0(-0.6)).toBe('-1');
    expect(fmt1(-0.05)).toBe('-0,1');
    expect(fmt2(-0.07)).toBe('-0,07');
  });
});

describe('CSV source column', () => {
  it('names the source in German', () => {
    expect(sourceLabel({ source: 'bls', foodId: 'bls:1' })).toBe('BLS');
    expect(sourceLabel({ source: 'off', foodId: 'off:1' })).toBe('Open Food Facts');
    expect(sourceLabel({ source: 'custom', foodId: 'c1' })).toBe('Eigenes');
    expect(sourceLabel({ source: 'quick', foodId: null })).toBe('Schnelleingabe');
    expect(sourceLabel({ source: 'ai', foodId: 'bls:1' })).toBe('KI-Analyse');
    expect(sourceLabel({ source: 'ai', foodId: null })).toBe('KI-Schätzung');
  });
});

describe('the running day in reports', () => {
  const row = (date: string, over: Partial<DailyRow> = {}): DailyRow => ({
    date,
    logged: true,
    mealsLogged: 2,
    completed: false,
    nutrients: { ENERCC: 1200, PROT625: 40, CHO: 120, FAT: 40 },
    targetKcal: 2000,
    targetProteinG: 130,
    targetFatG: 60,
    targetCarbsG: 200,
    exerciseKcal: 0,
    stepsKcal: 0,
    exerciseMinutes: 0,
    steps: null,
    distanceM: null,
    weightKg: null,
    ...over,
  });
  const today = '2026-11-10';

  it('draws today grey and exports it as not complete until it is closed', () => {
    const rows = [row('2026-11-09'), row(today)];
    const [, total, , , neutral] = buildChart(rows, 'kcal', true, true, today).data;
    expect(total).toEqual([1200, null]);
    expect(neutral).toEqual([null, 1200]);
    const lines = dailyCsv(rows, 'excel-de', today).trim().split(/\r?\n/);
    const col = lines[0]!.split(';').indexOf('Vollständig');
    expect(lines.slice(1).map((l) => l.split(';')[col])).toEqual(['ja', 'nein']);
    const closed = [row(today, { completed: true })];
    expect(buildChart(closed, 'kcal', true, true, today).data[1]).toEqual([1200]);
    expect(dailyCsv(closed, 'excel-de', today).split(/\r?\n/)[1]!.split(';')[col]).toBe('ja');
  });
});

describe('earliestDate (start of the "Alles" export)', () => {
  it('takes the first live record of food, weight, training and notes', async () => {
    const db = new UserDb(`n-${uuidv7()}`);
    expect(await earliestDate(db)).toBeNull();
    const base = { updatedAt: 1, deleted: false };
    await db.foodEntries.put({ ...base, id: 'f1', date: '2026-10-01' } as never);
    expect(await earliestDate(db)).toBe('2026-10-01');
    await db.weightEntries.put({ ...base, id: 'w1', date: '2026-09-20', kg: 80, purgedAt: null });
    await db.exerciseEntries.put({ ...base, id: 'x1', date: '2026-09-25' } as never);
    expect(await earliestDate(db)).toBe('2026-09-20');
    // Deleted records do not count.
    await db.dayNotes.put({ ...base, deleted: true, id: 'n1', date: '2026-08-01' } as never);
    expect(await earliestDate(db)).toBe('2026-09-20');
    await db.dayNotes.put({ ...base, id: 'n2', date: '2026-09-01' } as never);
    expect(await earliestDate(db)).toBe('2026-09-01');
    db.close();
  });
});
