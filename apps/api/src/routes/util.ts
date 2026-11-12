import type { Context } from 'hono';
import { getConnInfo } from '@hono/node-server/conninfo';
import type { z } from 'zod';

type Parsed<T> = { ok: true; data: T } | { ok: false; response: Response };

export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<Parsed<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    return { ok: false, response: c.json({ error: 'invalid_json' }, 400) };
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    return {
      ok: false,
      response: c.json(
        {
          error: 'validation',
          issues: r.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        400,
      ),
    };
  }
  return { ok: true, data: r.data };
}

/**
 * Client IP: the last X-Forwarded-For hop, which the one trusted proxy in front (Nginx Proxy Manager)
 * appends; earlier hops come from the client and can be anything. Without the header the socket
 * address.
 */
export function clientIp(c: Context): string {
  const hops = (c.req.header('x-forwarded-for') ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean);
  if (hops.length) return hops.at(-1)!;
  try {
    return getConnInfo(c).remote.address ?? 'unknown';
  } catch {
    return 'unknown';
  }
}
