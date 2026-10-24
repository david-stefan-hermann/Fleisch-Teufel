/**
 * Cooking fat in the AI review. Photo estimates miss fat systematically (an NIH test of four photo
 * apps found about 30 g of fat per meal too little): when no ingredient of the review is a fat, the
 * review offers oil and butter as one-tap rows.
 */
import type { Food } from '@ft/shared';

/** A fat or oil (BLS group Q, or a name that says so), also among the person's own foods. */
export function isFatFood(food: Pick<Food, 'name' | 'source' | 'sourceId' | 'group'>): boolean {
  if (food.source === 'bls' && food.sourceId?.startsWith('Q')) return true;
  return /\böl\b|olivenöl|rapsöl|sonnenblumenöl|butter\b|margarine|schmalz|dressing|mayonnaise|mayo\b|sahne\b/i.test(
    food.name,
  );
}

export interface FatOption {
  /** BLS food id. */
  foodId: string;
  /** Row name in the review. */
  name: string;
  /** Button label. */
  label: string;
  grams: number;
}

/** Typical amounts for one portion: a tablespoon of oil for frying, butter on bread or in the pan. */
export const FAT_OPTIONS: readonly FatOption[] = [
  { foodId: 'bls:Q180000', name: 'Rapsöl', label: 'Öl 10 g', grams: 10 },
  { foodId: 'bls:Q611000', name: 'Butter', label: 'Butter 10 g', grams: 10 },
];
