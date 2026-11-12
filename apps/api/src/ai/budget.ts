/**
 * Spending limit of the AI features per account: the summed `cost_usd` of all logged calls (failed
 * ones included) over rolling windows of 24 hours and 30 days. Rolling windows need no time zone.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { aiAnalyses } from '../db/schema.js';

export const DAY_MS = 86_400_000;
export const MONTH_MS = 30 * DAY_MS;

export type BudgetScope = 'day' | 'month';

export interface BudgetLimits {
  /** USD per 24 hours; 0 turns this limit off. */
  dayUsd: number;
  /** USD per 30 days; 0 turns this limit off. */
  monthUsd: number;
}

/** The window whose limit the account has reached, or null while another call is allowed. */
export async function budgetExceeded(
  db: Db,
  userId: string,
  limits: BudgetLimits,
  now = Date.now(),
): Promise<BudgetScope | null> {
  if (limits.dayUsd <= 0 && limits.monthUsd <= 0) return null;
  const day = new Date(now - DAY_MS).toISOString();
  const [spent] = await db
    .select({
      day: sql<number>`coalesce(sum(${aiAnalyses.costUsd}) filter (where ${aiAnalyses.createdAt} >= ${day}::timestamptz), 0)`.mapWith(
        Number,
      ),
      month: sql<number>`coalesce(sum(${aiAnalyses.costUsd}), 0)`.mapWith(Number),
    })
    .from(aiAnalyses)
    .where(and(eq(aiAnalyses.userId, userId), gte(aiAnalyses.createdAt, new Date(now - MONTH_MS))));
  if (limits.dayUsd > 0 && (spent?.day ?? 0) >= limits.dayUsd) return 'day';
  if (limits.monthUsd > 0 && (spent?.month ?? 0) >= limits.monthUsd) return 'month';
  return null;
}
