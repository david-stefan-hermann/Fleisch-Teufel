/** Meal slot that fits the current time: breakfast < 10:30, lunch < 15:00, dinner < 21:00, else snacks. */
export function defaultMealForNow(now = new Date()): number {
  const m = now.getHours() * 60 + now.getMinutes();
  if (m < 10 * 60 + 30) return 0;
  if (m < 15 * 60) return 1;
  if (m < 21 * 60) return 2;
  return 3;
}
