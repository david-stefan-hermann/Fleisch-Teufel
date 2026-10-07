import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAX_PHOTO_BYTES, sniffImage } from '../src/routes/photos.js';
import { createTestContext, registeredClient, type TestClient, type TestCtx } from './helpers.js';

let ctx: TestCtx;
let alice: TestClient;
let bob: TestClient;
beforeAll(async () => {
  ctx = await createTestContext({ env: { ALLOW_REGISTRATION: 'true' } });
  alice = await registeredClient(ctx, 'photo-alice@example.com');
  bob = await registeredClient(ctx, 'photo-bob@example.com');
});
afterAll(() => ctx.close());

const jpeg = (size = 2048): Uint8Array<ArrayBuffer> => {
  const b = new Uint8Array(size);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  for (let i = 4; i < size; i++) b[i] = i % 251;
  return b;
};

const put = (c: TestClient, id: string, body: Uint8Array<ArrayBuffer>, type = 'image/jpeg') =>
  ctx.app.request(`/api/photos/${id}`, {
    method: 'PUT',
    headers: { cookie: c.cookie!, 'content-type': type },
    body,
  });
const get = (c: TestClient | null, id: string) =>
  ctx.app.request(`/api/photos/${id}`, { headers: c ? { cookie: c.cookie! } : {} });

describe('photos', () => {
  it('stores a photo and serves it back to its owner only', async () => {
    const data = jpeg();
    const r = await put(alice, 'photo-0001', data);
    expect(r.status).toBe(200);
    const back = await get(alice, 'photo-0001');
    expect(back.status).toBe(200);
    expect(back.headers.get('content-type')).toBe('image/jpeg');
    expect(back.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await back.arrayBuffer())).toEqual(data);
    expect((await get(bob, 'photo-0001')).status).toBe(404);
    expect((await get(null, 'photo-0001')).status).toBe(401);
  });

  it('is idempotent and keeps the first version of an id', async () => {
    const first = jpeg(1000);
    expect((await put(alice, 'photo-0002', first)).status).toBe(200);
    expect((await put(alice, 'photo-0002', jpeg(3000))).status).toBe(200);
    expect((await (await get(alice, 'photo-0002')).arrayBuffer()).byteLength).toBe(1000);
  });

  it('rejects non-images, oversized files and bad ids', async () => {
    expect((await put(alice, 'photo-0003', new TextEncoder().encode('<svg onload=alert(1)>'))).status).toBe(
      415,
    );
    expect((await put(alice, 'photo-0004', jpeg(MAX_PHOTO_BYTES + 10))).status).toBe(413);
    expect((await put(alice, 'bad%20id!', jpeg())).status).toBe(400);
    expect((await put(alice, 'short', jpeg())).status).toBe(400);
  });

  it('recognises image signatures', () => {
    expect(sniffImage(jpeg())).toBe('image/jpeg');
    expect(sniffImage(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffImage(new TextEncoder().encode('GIF89a......'))).toBeNull();
  });
});
