import { describe, expect, it } from 'vitest';
import { placeButton } from '@/features/assistant/place';

const base = { size: 56, min: 100, max: 700, gap: 8 };

describe('placeButton', () => {
  it('without zones takes the wanted spot, clamped', () => {
    expect(placeButton({ ...base, want: 300, zones: [] })).toBe(300);
    expect(placeButton({ ...base, want: Infinity, zones: [] })).toBe(700);
    expect(placeButton({ ...base, want: 0, zones: [] })).toBe(100);
  });

  it('keeps a wanted spot outside the zones', () => {
    expect(placeButton({ ...base, want: 600, zones: [{ top: 150, bottom: 500 }] })).toBe(600);
  });

  it('moves out of a zone to its nearer edge', () => {
    const zones = [{ top: 150, bottom: 500 }];
    // Blocked: (86, 508). Below is nearer for 450, above for 120... min is 100.
    expect(placeButton({ ...base, want: 450, zones })).toBe(508);
    expect(placeButton({ ...base, want: 200, zones: [{ top: 300, bottom: 500 }] })).toBe(200);
    expect(placeButton({ ...base, want: 260, zones: [{ top: 300, bottom: 500 }] })).toBe(236);
  });

  it('as low as allowed below a camera picture', () => {
    expect(placeButton({ ...base, want: Infinity, zones: [{ top: 150, bottom: 695 }] })).toBeNull();
    expect(placeButton({ ...base, want: Infinity, zones: [{ top: 150, bottom: 600 }] })).toBe(700);
  });

  it('uses a gap between two zones only when the button fits', () => {
    const fits = [
      { top: 120, bottom: 300 },
      { top: 380, bottom: 700 },
    ];
    // Gap 300..380 is 80 px: 56 + 2 × 8 = 72 fits (top edges 308 to 316, the lower is nearer).
    expect(placeButton({ ...base, want: 500, zones: fits })).toBe(316);
    const tight = [
      { top: 120, bottom: 300 },
      { top: 360, bottom: 700 },
    ];
    expect(placeButton({ ...base, want: 500, zones: tight })).toBeNull();
  });

  it('a tie goes to the lower spot', () => {
    // Blocked (186, 400); want 293 is 107 from both edges.
    expect(placeButton({ ...base, want: 293, zones: [{ top: 250, bottom: 392 }] })).toBe(400);
  });

  it('"Groß" needs more room', () => {
    const zones = [{ top: 150, bottom: 640 }];
    expect(placeButton({ ...base, want: Infinity, zones })).toBe(700);
    expect(placeButton({ ...base, size: 112, max: 644, want: Infinity, zones })).toBeNull();
    expect(
      placeButton({ ...base, size: 112, max: 700, want: Infinity, zones: [{ top: 150, bottom: 500 }] }),
    ).toBe(700);
  });

  it('nothing free when max is below min', () => {
    expect(placeButton({ ...base, min: 300, max: 200, want: 250, zones: [] })).toBeNull();
  });
});
