import { describe, expect, it } from 'vitest';
import { matchesTrash } from '@/features/more/trashSearch';

describe('matchesTrash', () => {
  it('searches the trash by folded words', () => {
    expect(matchesTrash('', ['Toast'])).toBe(true);
    expect(matchesTrash('  ', [])).toBe(true);
    expect(matchesTrash('kase', ['Käsebrot'])).toBe(true);
    expect(matchesTrash('KÄSE brot', ['Käsebrot mit Butter'])).toBe(true);
    expect(matchesTrash('12.11', ['2026-11-12', '12.11.2026', '82,40'])).toBe(true);
    expect(matchesTrash('82,4', ['2026-11-12', '12.11.2026', '82,40'])).toBe(true);
    expect(matchesTrash('lauf', ['Oberkörper', 'Krafttraining 60 Min. · Laufen 30 Min.'])).toBe(true);
    expect(matchesTrash('rad', ['Oberkörper', 'Krafttraining'])).toBe(false);
  });
});
