import { GOALS, planFromPreset, type GoalKind, type MacroPlan, type Settings } from '@ft/shared';

/** The plan a goal starts with; a stored plan of its own (custom, low carb) stays. */
export function initialPlan(settings: Settings, kind: GoalKind, known: boolean): MacroPlan {
  const p = settings.macroPlan;
  if (known && p && (p.preset === 'custom' || p.preset === 'low_carb')) return p;
  return planFromPreset(GOALS[kind].preset);
}
