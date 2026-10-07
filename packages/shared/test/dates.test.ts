import { describe, expect, it } from 'vitest';
import {
  addDays,
  ageOn,
  dateRange,
  diffDays,
  endOfMonth,
  isISODate,
  startOfWeek,
  weekdayIndex,
} from '../src/dates.js';

describe('dates', () => {
  it('validates ISO dates strictly', () => {
    expect(isISODate('2026-10-07')).toBe(true);
    expect(isISODate('2026-02-30')).toBe(false);
    expect(isISODate('2026-1-07')).toBe(false);
  });

  it('adds days across month, year and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30'); // EU DST switch
    expect(addDays('2026-10-25', -1)).toBe('2026-10-24');
  });

  it('computes day differences DST-safe', () => {
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
    expect(diffDays('2026-10-30', '2026-10-24')).toBe(-6);
  });

  it('uses Monday-based weekdays', () => {
    expect(weekdayIndex('2026-10-05')).toBe(0); // Monday
    expect(weekdayIndex('2026-10-11')).toBe(6); // Sunday
    expect(startOfWeek('2026-10-07')).toBe('2026-10-05');
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05');
  });

  it('builds inclusive ranges and month ends', () => {
    expect(dateRange('2026-02-27', '2026-03-02')).toEqual([
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
      '2026-03-02',
    ]);
    expect(endOfMonth('2028-02-10')).toBe('2028-02-29');
  });

  it('computes age in full years', () => {
    expect(ageOn('1990-10-08', '2026-10-07')).toBe(35);
    expect(ageOn('1990-10-07', '2026-10-07')).toBe(36);
  });
});
