import { describe, expect, it } from 'vitest';
import { incomingWins, nextVersion, stableStringify } from '../src/sync.js';
import { uuidv7, uuidv7Timestamp } from '../src/ids.js';

describe('last write wins', () => {
  const a = { id: 'x', updatedAt: 10, deleted: false, v: 1 };

  it('accepts anything when nothing is stored', () => {
    expect(incomingWins(undefined, a)).toBe(true);
  });

  it('prefers the newer version', () => {
    expect(incomingWins(a, { ...a, updatedAt: 11, v: 0 })).toBe(true);
    expect(incomingWins(a, { ...a, updatedAt: 9, v: 2 })).toBe(false);
  });

  it('breaks ties deterministically and symmetrically', () => {
    const b = { ...a, v: 2 };
    expect(incomingWins(a, b)).not.toBe(incomingWins(b, a));
    expect(incomingWins(a, { ...a })).toBe(false);
  });

  it('treats a newer tombstone as a delete', () => {
    expect(incomingWins(a, { ...a, updatedAt: 12, deleted: true })).toBe(true);
  });

  it('serializes with stable key order', () => {
    expect(stableStringify({ b: 1, a: [1, { d: 1, c: 2 }] })).toBe('{"a":[1,{"c":2,"d":1}],"b":1}');
  });

  it('produces strictly increasing local versions', () => {
    expect(nextVersion(undefined, 100)).toBe(100);
    expect(nextVersion(100, 100)).toBe(101);
    expect(nextVersion(200, 100)).toBe(201);
    expect(nextVersion(50, 100)).toBe(100);
  });
});

describe('uuidv7', () => {
  it('is RFC 9562 shaped, time-ordered and decodes its timestamp', () => {
    const ids = Array.from({ length: 200 }, () => uuidv7(1_760_000_000_000));
    for (const id of ids)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(ids.length);
    expect(uuidv7Timestamp(ids[0]!)).toBe(1_760_000_000_000);
  });
});
