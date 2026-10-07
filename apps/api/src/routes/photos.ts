/**
 * Meal photos. Devices store photos locally first and upload them in the background; any device
 * fetches a photo by id when a synced meal references it. Photos are immutable, so responses can
 * be cached forever (per user, never shared caches).
 */
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { requireUser } from '../auth/session.js';
import { photos } from '../db/schema.js';
import { RateLimiter } from '../rate-limit.js';
import type { AppEnv, Deps } from '../types.js';

export const MAX_PHOTO_BYTES = 1.5 * 1024 * 1024;
const ID = /^[A-Za-z0-9_-]{8,64}$/;

/** Detects the format from the file signature; the declared content type is not trusted. */
export function sniffImage(buf: Uint8Array): 'image/jpeg' | 'image/webp' | 'image/png' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47)
    return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));
  if (buf.length > 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function photoRoutes(deps: Deps) {
  const { db } = deps;
  const limiter = new RateLimiter(300, 60 * 60_000);
  const app = new Hono<AppEnv>();
  app.use('*', requireUser(db));

  app.put('/:id', async (c) => {
    const id = c.req.param('id');
    if (!ID.test(id)) return c.json({ error: 'invalid_id' }, 400);
    const user = c.get('user');
    if (limiter.take(user.id) > 0) return c.json({ error: 'too_many_requests' }, 429);
    const declared = Number(c.req.header('content-length') ?? 0);
    if (declared > MAX_PHOTO_BYTES) return c.json({ error: 'too_large' }, 413);
    const buf = new Uint8Array(await c.req.arrayBuffer());
    if (buf.length > MAX_PHOTO_BYTES) return c.json({ error: 'too_large' }, 413);
    const mime = sniffImage(buf);
    if (!mime) return c.json({ error: 'unsupported_image_type' }, 415);
    // Idempotent: a retried upload of the same id keeps the first version (photos are immutable).
    await db
      .insert(photos)
      .values({ userId: user.id, id, mime, bytes: buf.length, data: Buffer.from(buf) })
      .onConflictDoNothing();
    return c.json({ ok: true, id });
  });

  app.get('/:id', async (c) => {
    const id = c.req.param('id');
    if (!ID.test(id)) return c.json({ error: 'invalid_id' }, 400);
    const [row] = await db
      .select({ mime: photos.mime, data: photos.data })
      .from(photos)
      .where(and(eq(photos.userId, c.get('user').id), eq(photos.id, id)));
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.body(new Uint8Array(row.data), 200, {
      'content-type': row.mime,
      'cache-control': 'private, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
  });

  return app;
}
