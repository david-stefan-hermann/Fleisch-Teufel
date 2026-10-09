import { describe, expect, it } from 'vitest';
import { fitSize, IMAGE_PRESETS } from '@/features/ai/image';

describe('fitSize (pixel budget and 1080p, the stricter wins)', () => {
  it('keeps the pixel budget for a 12 MP phone photo', () => {
    expect(fitSize(4032, 3024, IMAGE_PRESETS.analysis.maxPixels)).toEqual({ width: 1155, height: 866 });
    expect(fitSize(4032, 3024, IMAGE_PRESETS.mealPhoto.maxPixels)).toEqual({ width: 894, height: 671 });
  });

  it('caps a label photo at 1080p although 2 MP would allow more', () => {
    expect(fitSize(4032, 3024, IMAGE_PRESETS.label.maxPixels)).toEqual({ width: 1440, height: 1080 });
    // Portrait: the short edge is the width.
    expect(fitSize(3024, 4032, IMAGE_PRESETS.label.maxPixels)).toEqual({ width: 1080, height: 1440 });
  });

  it('caps the long edge of a panorama at 1920', () => {
    expect(fitSize(8000, 2000, IMAGE_PRESETS.label.maxPixels)).toEqual({ width: 1920, height: 480 });
  });

  it('never upscales and stays at least 1 px', () => {
    expect(fitSize(640, 480, IMAGE_PRESETS.analysis.maxPixels)).toEqual({ width: 640, height: 480 });
    expect(fitSize(1, 1, 1)).toEqual({ width: 1, height: 1 });
    expect(fitSize(100_000, 1, IMAGE_PRESETS.analysis.maxPixels)).toEqual({ width: 1920, height: 1 });
  });

  it('every preset stays within 1080p and its budget for common camera sizes', () => {
    for (const preset of Object.values(IMAGE_PRESETS))
      for (const [w, h] of [
        [4032, 3024],
        [3024, 4032],
        [4000, 2250],
        [1920, 1080],
        [5712, 4284],
      ] as const) {
        const { width, height } = fitSize(w, h, preset.maxPixels);
        expect(Math.max(width, height)).toBeLessThanOrEqual(1920);
        expect(Math.min(width, height)).toBeLessThanOrEqual(1080);
        expect(width * height).toBeLessThanOrEqual(preset.maxPixels * 1.01);
      }
  });
});
