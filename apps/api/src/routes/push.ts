/**
 * Web Push subscriptions of the daily reminder (see `push.ts`). A device subscribes with the browser's
 * endpoint and keys plus the local time it wants; the same endpoint can only belong to one account
 * (a shared device that signs in as someone else takes the subscription with it).
 */
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { requireUser } from '../auth/session.js';
import { pushSubscriptions } from '../db/schema.js';
import { REMIND_AT, validTimeZone } from '../push.js';
import type { AppEnv, Deps } from '../types.js';
import { parseJson } from './util.js';

const endpointSchema = z.url().max(2000);

export const pushSubscriptionSchema = z.object({
  endpoint: endpointSchema,
  keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  remindAt: z.string().regex(REMIND_AT),
  tz: z.string().min(1).max(64).refine(validTimeZone, 'unknown time zone'),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

export interface PushSubscriptionInfo {
  remindAt: string;
  tz: string;
}

export function pushRoutes(deps: Deps) {
  const { db, push } = deps;
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(db));

  /** Whether the server can send reminders, and the key the browser needs to subscribe. */
  app.get('/config', (c) => {
    const config: PushConfig = { enabled: push !== null, publicKey: push?.publicKey ?? null };
    return c.json(config);
  });

  /** The reminder settings stored for this device's endpoint, or 404. */
  app.get('/subscription', async (c) => {
    const endpoint = endpointSchema.safeParse(c.req.query('endpoint'));
    if (!endpoint.success) return c.json({ error: 'validation' }, 400);
    const me = c.get('user');
    const [row] = await db
      .select({ remindAt: pushSubscriptions.remindAt, tz: pushSubscriptions.tz })
      .from(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, me.id), eq(pushSubscriptions.endpoint, endpoint.data)));
    if (!row) return c.json({ error: 'not_found' }, 404);
    const info: PushSubscriptionInfo = row;
    return c.json(info);
  });

  /** Creates or updates the subscription of this device (time, zone, keys). */
  app.put('/subscription', async (c) => {
    if (!push) return c.json({ error: 'push_disabled' }, 503);
    const body = await parseJson(c, pushSubscriptionSchema);
    if (!body.ok) return body.response;
    const me = c.get('user');
    const { endpoint, keys, remindAt, tz } = body.data;
    await db
      .insert(pushSubscriptions)
      .values({ endpoint, userId: me.id, p256dh: keys.p256dh, auth: keys.auth, remindAt, tz })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        // A new owner or a new time: the reminder starts fresh (today is not "handled" any more).
        set: {
          userId: me.id,
          p256dh: keys.p256dh,
          auth: keys.auth,
          remindAt,
          tz,
          lastSentOn: null,
          failures: 0,
        },
      });
    return c.json({ ok: true });
  });

  /** Removes the subscription of this device. */
  app.delete('/subscription', async (c) => {
    const body = await parseJson(c, z.object({ endpoint: endpointSchema }));
    if (!body.ok) return body.response;
    const me = c.get('user');
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, me.id), eq(pushSubscriptions.endpoint, body.data.endpoint)));
    return c.json({ ok: true });
  });

  return app;
}
