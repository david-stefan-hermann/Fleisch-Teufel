/**
 * Open Food Facts proxy client. OFF asks API users for a descriptive User-Agent and to respect
 * rate limits: 15 req/min for product lookups, 10 req/min for searches
 * (https://openfoodfacts.github.io/openfoodfacts-server/api/). Requests above the limit are not
 * sent; callers fall back to the local cache.
 */
import type { Food } from '@ft/shared';
import { log } from '../log.js';
import { RateLimiter } from '../rate-limit.js';
import { normalizeOffProduct, type OffProduct } from './normalize.js';

const FIELDS = [
  'code',
  'product_name',
  'product_name_de',
  'generic_name_de',
  'brands',
  'quantity',
  'serving_size',
  'serving_quantity',
  'product_quantity',
  'product_quantity_unit',
  'image_front_small_url',
  'nutriments',
].join(',');

export class OffRateLimitedError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super('Open Food Facts rate limit reached');
  }
}

export interface OffClient {
  product(ean: string): Promise<Food | null>;
  search(query: string, limit?: number): Promise<Food[]>;
}

export interface OffClientOptions {
  baseUrl: string;
  searchUrl: string;
  userAgent: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

export function createOffClient(opts: OffClientOptions): OffClient {
  const doFetch = opts.fetch ?? fetch;
  const productLimiter = new RateLimiter(15, 60_000);
  const searchLimiter = new RateLimiter(10, 60_000);
  const timeoutMs = opts.timeoutMs ?? 8000;

  async function getJson(url: string): Promise<{ status: number; body: unknown }> {
    const res = await doFetch(url, {
      headers: { 'User-Agent': opts.userAgent, Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) return { status: res.status === 200 ? 502 : res.status, body: null };
    return { status: res.status, body: await res.json() };
  }

  return {
    async product(ean) {
      const wait = productLimiter.take();
      if (wait > 0) throw new OffRateLimitedError(wait);
      const { status, body } = await getJson(
        `${opts.baseUrl}/api/v2/product/${encodeURIComponent(ean)}?fields=${FIELDS}`,
      );
      if (status === 404) return null;
      if (status !== 200) throw new Error(`OFF product HTTP ${status}`);
      const b = body as { status?: number; product?: OffProduct };
      if (b.status === 0 || !b.product) return null;
      return normalizeOffProduct({ ...b.product, code: b.product.code ?? ean });
    },

    async search(query, limit = 20) {
      const wait = searchLimiter.take();
      if (wait > 0) throw new OffRateLimitedError(wait);
      const q = encodeURIComponent(query);
      // Search-a-licious (Elasticsearch based, beta) …
      try {
        const { status, body } = await getJson(
          `${opts.searchUrl}/search?q=${q}&page_size=${limit}&langs=de,en&fields=${FIELDS}`,
        );
        if (status === 200) {
          const hits = (body as { hits?: OffProduct[] }).hits ?? [];
          return hits.map(normalizeOffProduct).filter((f): f is Food => f !== null);
        }
        log.warn('OFF search-a-licious failed', { status });
      } catch (e) {
        log.warn('OFF search-a-licious error', { error: String(e) });
      }
      // … with the classic search as fallback.
      const { status, body } = await getJson(
        `${opts.baseUrl}/cgi/search.pl?search_terms=${q}&search_simple=1&json=1&page_size=${limit}&fields=${FIELDS}`,
      );
      if (status !== 200) throw new Error(`OFF search HTTP ${status}`);
      const products = (body as { products?: OffProduct[] }).products ?? [];
      return products.map(normalizeOffProduct).filter((f): f is Food => f !== null);
    },
  };
}
