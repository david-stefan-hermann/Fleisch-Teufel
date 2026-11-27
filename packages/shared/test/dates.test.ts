import { describe, expect, it } from 'vitest';
import {
  addDays,
  ageOn,
  dateRange,
  diffDays,
  endOfMonth,
  isISODate,
  nextDayStart,
  nightEndHour,
  startOfWeek,
  today,
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

describe('start of the day', () => {
  const at = (h: number, m = 0) => new Date(2026, 10, 27, h, m);

  it('counts the hours before the start for the day before', () => {
    expect(today(at(4, 59))).toBe('2026-11-26');
    expect(today(at(5))).toBe('2026-11-27');
    expect(today(at(1, 30), null)).toBe('2026-11-26');
    expect(today(at(1, 30), 0)).toBe('2026-11-27');
    expect(today(at(2, 59), 3)).toBe('2026-11-26');
    expect(today(at(3), 3)).toBe('2026-11-27');
    expect(today(at(23, 59), 8)).toBe('2026-11-27');
  });

  it('goes back over the first of a month', () => {
    expect(today(new Date(2026, 10, 1, 2))).toBe('2026-10-31');
  });

  it('knows when the day ends', () => {
    expect(nextDayStart(at(4, 59)).getTime()).toBe(at(5).getTime());
    expect(nextDayStart(at(5)).getTime()).toBe(new Date(2026, 10, 28, 5).getTime());
    expect(nextDayStart(at(12), 0).getTime()).toBe(new Date(2026, 10, 28, 0).getTime());
    expect(nextDayStart(at(1), 3).getTime()).toBe(at(3).getTime());
  });

  it('lets the night end with the day, at five when the day starts at midnight', () => {
    expect(nightEndHour()).toBe(5);
    expect(nightEndHour(3)).toBe(3);
    expect(nightEndHour(8)).toBe(8);
    expect(nightEndHour(0)).toBe(5);
  });
});
