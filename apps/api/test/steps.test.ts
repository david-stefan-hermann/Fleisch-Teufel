import { dayId, type ExerciseEntry } from '@ft/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { stepsDays } from '../src/steps/import.js';
import { parseDay, parseDistanceM, parseList, parseNumber, StepsParseError } from '../src/steps/parse.js';
import { createTestContext, registeredClient, TestClient, type TestCtx } from './helpers.js';

describe('reading the shortcut', () => {
  it('takes lists as arrays or as text with one line per item', () => {
    expect(parseList(['a', 2], 'x')).toEqual(['a', '2']);
    expect(parseList('2026-11-09\n2026-11-10\r\n\n', 'x')).toEqual(['2026-11-09', '2026-11-10']);
    expect(parseList(undefined, 'x')).toEqual([]);
    expect(() => parseList([{}], 'x')).toThrow(StepsParseError);
  });

  it('reads the day of ISO dates and of the phone format seen in the probe', () => {
    expect(parseDay('2026-11-10')).toBe('2026-11-10');
    // The phone's local day, whatever the offset says about UTC.
    expect(parseDay('2026-11-10T00:30:00+01:00')).toBe('2026-11-10');
    // What the probe showed without a date format (day first, no zone).
    expect(parseDay('03/11/2026, 02:41')).toBe('2026-11-03');
    expect(parseDay('3.11.2026, 14:02')).toBe('2026-11-03');
    expect(parseDay('11/31/2026')).toBeNull();
    expect(parseDay('gestern')).toBeNull();
  });

  it('reads counts with thousands separators and distances with a decimal comma and units', () => {
    expect(parseNumber('8432', 'count')).toBe(8432);
    expect(parseNumber('8.432', 'count')).toBe(8432);
    expect(parseNumber('8 432 Schritte', 'count')).toBe(8432);
    expect(parseNumber('8432,0', 'count')).toBe(8432);
    expect(parseNumber('12,345.5', 'count')).toBe(12345.5);
    expect(parseDistanceM('6,1 km')).toBe(6100);
    expect(parseDistanceM('6.1')).toBe(6100);
    expect(parseDistanceM('6,123')).toBe(6123);
    expect(parseDistanceM('850 m')).toBe(850);
    expect(parseDistanceM('2 mi')).toBeCloseTo(3218.688);
    expect(parseDistanceM('viel')).toBeNull();
  });

  it('sums per day and keeps today and the six days before, never the cut day before them', () => {
    const days = stepsDays({
      stepDates: ['2026-11-03', '2026-11-04', '2026-11-04', '2026-11-10'].join('\n'),
      stepValues: '5000\n1000\n2.500\n8432',
      distanceDates: ['2026-11-04', '2026-11-10'],
      distanceValues: ['2,8', '6,1'],
      now: '2026-11-10',
    });
    expect(days).toEqual([
      { date: '2026-11-04', steps: 3500, distanceM: 2800 },
      { date: '2026-11-10', steps: 8432, distanceM: 6100 },
    ]);
  });

  it('without a date for today leaves out the oldest day sent', () => {
    const days = stepsDays({ stepDates: ['2026-11-08', '2026-11-09'], stepValues: ['100', '200'] });
    expect(days.map((d) => d.date)).toEqual(['2026-11-09']);
  });

  it('refuses lists of different length', () => {
    expect(() => stepsDays({ stepDates: ['2026-11-08'], stepValues: ['1', '2'] })).toThrow(/1 dates but 2/);
  });
});

let ctx: TestCtx;
let alice: TestClient;
let bob: TestClient;

beforeAll(async () => {
  ctx = await createTestContext({ env: { ALLOW_REGISTRATION: 'true' } });
  alice = await registeredClient(ctx, 'steps-alice@example.com');
  bob = await registeredClient(ctx, 'steps-bob@example.com');
});
afterAll(() => ctx.close());

/** A client with the shortcut's header: a steps token, no cookie, no Origin. */
const shortcut = (token: string) => new TestClient(ctx.app, { authorization: `Bearer ${token}` });

async function newToken(c: TestClient): Promise<string> {
  const r = await c.post('/api/steps/token');
  expect(r.status).toBe(200);
  expect(r.json.token).toMatch(/^ftst_/);
  return r.json.token;
}

async function pullAll(c: TestClient, since = 0) {
  const r = await c.get(`/api/sync/pull?since=${since}`);
  expect(r.status).toBe(200);
  return r.json as { changes: { table: string; data: any }[]; cursor: number };
}

async function stepsEntry(c: TestClient, date: string): Promise<ExerciseEntry | undefined> {
  const { changes } = await pullAll(c);
  return changes.find((x) => x.data.id === dayId.steps(date))?.data;
}

const week = (date: string, steps: string, km: string | null = null) => ({
  stepDates: date,
  stepValues: steps,
  ...(km !== null ? { distanceDates: date, distanceValues: km } : {}),
  now: date,
});

describe('steps access', () => {
  it('creates, shows, replaces and deletes the access; only the newest token works', async () => {
    let status = await bob.get('/api/steps/status');
    expect(status.json).toEqual({ configured: false, createdAt: null, lastUsedAt: null });
    const first = await newToken(bob);
    status = await bob.get('/api/steps/status');
    expect(status.json).toMatchObject({ configured: true, lastUsedAt: null });
    expect((await shortcut(first).post('/api/steps/import', week('2026-11-10', '10'))).status).toBe(200);
    expect((await bob.get('/api/steps/status')).json.lastUsedAt).toEqual(expect.any(Number));

    const second = await newToken(bob);
    expect((await shortcut(first).post('/api/steps/import', week('2026-11-10', '10'))).status).toBe(401);
    expect((await shortcut(second).post('/api/steps/import', week('2026-11-10', '10'))).status).toBe(200);

    expect((await bob.req('DELETE', '/api/steps/token')).status).toBe(200);
    expect((await shortcut(second).post('/api/steps/import', week('2026-11-10', '10'))).status).toBe(401);
    expect((await bob.get('/api/steps/status')).json.configured).toBe(false);
  });

  it('keeps the steps token and sessions apart', async () => {
    const token = await newToken(alice);
    // The steps token opens nothing else.
    expect((await shortcut(token).get('/api/sync/pull?since=0')).status).toBe(401);
    expect((await shortcut(token).get('/api/steps/status')).status).toBe(401);
    // A session is no access to the import, neither as cookie nor as bearer token.
    expect((await alice.post('/api/steps/import', week('2026-11-10', '5000'))).status).toBe(401);
    const sessionToken = alice.cookie!.replace('ft_session=', '');
    expect((await shortcut(sessionToken).post('/api/steps/import', week('2026-11-10', '5000'))).status).toBe(
      401,
    );
    expect((await new TestClient(ctx.app).post('/api/steps/import', week('2026-11-10', '5000'))).status).toBe(
      401,
    );
  });

  it('answers unreadable lists with a message', async () => {
    const token = await newToken(alice);
    const r = await shortcut(token).post('/api/steps/import', {
      stepDates: ['2026-11-10', '2026-11-09'],
      stepValues: ['1'],
    });
    expect(r.status).toBe(400);
    expect(r.json.message).toMatch(/2 dates but 1 values/);
  });
});

describe('steps import', () => {
  let token: string;
  beforeAll(async () => {
    token = await newToken(alice);
    await alice.post('/api/sync/push', {
      records: [
        {
          table: 'weightEntries',
          data: { id: 'w:2026-10-01', updatedAt: 1, deleted: false, date: '2026-10-01', kg: 80 },
        },
      ],
    });
  });

  it('writes one training per day from the minimum on, and nothing twice', async () => {
    const send = () =>
      shortcut(token).post('/api/steps/import', {
        stepDates: '2026-10-20\n2026-10-21\n2026-10-21',
        stepValues: '640\n5000\n3.432',
        distanceDates: '2026-10-21',
        distanceValues: '6,1 km',
        now: '2026-10-21T14:02:11+02:00',
      });
    const r = await send();
    expect(r.status).toBe(200);
    expect(r.json).toEqual({
      ok: true,
      days: [
        { date: '2026-10-20', steps: 640, written: false },
        { date: '2026-10-21', steps: 8432, written: true },
      ],
    });
    const e = await stepsEntry(alice, '2026-10-21');
    expect(e).toMatchObject({
      typeKey: 'steps',
      name: 'Schritte',
      steps: 8432,
      distanceM: 6100,
      minutes: 76,
      met: 3.5,
      weightKg: 80,
      kcal: 253,
      deleted: false,
    });
    expect(await stepsEntry(alice, '2026-10-20')).toBeUndefined();

    // The same import again changes nothing: no new change for the devices to pull.
    const { cursor } = await pullAll(alice);
    const again = await send();
    expect(again.json.days.every((d: { written: boolean }) => !d.written)).toBe(true);
    expect((await pullAll(alice, cursor)).changes).toEqual([]);
  });

  it('updates an existing day also below the minimum', async () => {
    await shortcut(token).post('/api/steps/import', week('2026-10-22', '4000'));
    const r = await shortcut(token).post('/api/steps/import', week('2026-10-22', '900'));
    expect(r.json.days[0].written).toBe(true);
    expect(await stepsEntry(alice, '2026-10-22')).toMatchObject({ steps: 900, distanceM: null, minutes: 9 });
  });

  it('follows the minimum from the settings', async () => {
    const settings = {
      id: 'profile',
      updatedAt: Date.now(),
      deleted: false,
      sex: null,
      birthDate: null,
      heightCm: null,
      activityLevel: 'light',
      targetWeightKg: null,
      weeklyRateKg: -0.5,
      mealNames: ['Frühstück', 'Mittag', 'Abend', 'Snacks'],
      addExerciseCalories: true,
      onboardedAt: null,
      stepsMinimum: 5000,
    };
    expect(
      (await alice.post('/api/sync/push', { records: [{ table: 'settings', data: settings }] })).json.applied,
    ).toBe(1);
    const r = await shortcut(token).post('/api/steps/import', week('2026-10-23', '4000'));
    expect(r.json.days[0].written).toBe(false);
    await alice.post('/api/sync/push', {
      records: [{ table: 'settings', data: { ...settings, updatedAt: Date.now(), stepsMinimum: null } }],
    });
  });

  it('keeps typed kcal and the note, recomputes computed kcal with a new weight', async () => {
    await shortcut(token).post('/api/steps/import', week('2026-10-24', '8432', '6,1'));
    const e = (await stepsEntry(alice, '2026-10-24'))!;
    // A device types the kcal of the watch and a note.
    await alice.post('/api/sync/push', {
      records: [
        { table: 'exerciseEntries', data: { ...e, updatedAt: e.updatedAt + 1, kcal: 290, note: 'Stadt' } },
      ],
    });
    await shortcut(token).post('/api/steps/import', week('2026-10-24', '9000', '6,5'));
    expect(await stepsEntry(alice, '2026-10-24')).toMatchObject({
      steps: 9000,
      distanceM: 6500,
      kcal: 290,
      note: 'Stadt',
    });

    await shortcut(token).post('/api/steps/import', week('2026-10-25', '8432', '6,1'));
    await alice.post('/api/sync/push', {
      records: [
        {
          table: 'weightEntries',
          data: { id: 'w:2026-10-25', updatedAt: 1, deleted: false, date: '2026-10-25', kg: 70 },
        },
      ],
    });
    await shortcut(token).post('/api/steps/import', week('2026-10-25', '8432', '6,1'));
    expect(await stepsEntry(alice, '2026-10-25')).toMatchObject({ weightKg: 70, kcal: 222 });
  });

  it('leaves a deleted day deleted', async () => {
    await shortcut(token).post('/api/steps/import', week('2026-10-26', '7000'));
    const e = (await stepsEntry(alice, '2026-10-26'))!;
    await alice.post('/api/sync/push', {
      records: [{ table: 'exerciseEntries', data: { ...e, updatedAt: e.updatedAt + 1, deleted: true } }],
    });
    const r = await shortcut(token).post('/api/steps/import', week('2026-10-26', '9000'));
    expect(r.json.days[0].written).toBe(false);
    expect(await stepsEntry(alice, '2026-10-26')).toMatchObject({ deleted: true, steps: 7000 });
  });

  it('wins over a version a device stamped ahead of the server clock', async () => {
    await shortcut(token).post('/api/steps/import', week('2026-10-27', '7000'));
    const e = (await stepsEntry(alice, '2026-10-27'))!;
    const ahead = Date.now() + 2 * 60_000;
    await alice.post('/api/sync/push', {
      records: [{ table: 'exerciseEntries', data: { ...e, updatedAt: ahead, note: 'vorgehende Uhr' } }],
    });
    const r = await shortcut(token).post('/api/steps/import', week('2026-10-27', '9000'));
    expect(r.status).toBe(200);
    const after = (await stepsEntry(alice, '2026-10-27'))!;
    expect(after).toMatchObject({ steps: 9000, note: 'vorgehende Uhr' });
    expect(after.updatedAt).toBeGreaterThan(ahead);
  });
});
