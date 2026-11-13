import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { imageInfo, readSkinPack, SkinPackError } from '@/features/assistant/skins/pack';
import { pixelBox } from '@/features/assistant/skins/SkinFace';

/** The header of a PNG of the given size (enough for the checks). */
const png = (w: number, h: number) => {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  b.set(strToU8('IHDR'), 12);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

const manifest = (over: Record<string, unknown> = {}) => ({
  format: 'fleisch-teufel-skin',
  version: 1,
  name: 'Testfigur',
  style: 'free',
  images: { ruhe: 'ruhe.png', froh: 'froh.png' },
  states: { idle: 'ruhe', done: 'froh' },
  idle: ['froh'],
  ...over,
});

const pack = (files: Record<string, Uint8Array>) => zipSync(files);
const error = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(SkinPackError);
    return (e as Error).message;
  }
  throw new Error('no error');
};

describe('figure packs (zip with skin.json)', () => {
  it('reads a pack, also zipped with its folder', () => {
    const zip = pack({
      'figur/skin.json': strToU8(JSON.stringify(manifest())),
      'figur/ruhe.png': png(256, 256),
      'figur/froh.png': png(256, 256),
    });
    const p = readSkinPack(zip);
    expect(p.manifest.name).toBe('Testfigur');
    expect(Object.keys(p.images).sort()).toEqual(['froh.png', 'ruhe.png']);
    expect(p.images['ruhe.png']!.type).toBe('image/png');
    expect(p.width).toBe(256);
  });

  it('refuses what is not a figure', () => {
    expect(error(() => readSkinPack(new Uint8Array([1, 2, 3])))).toContain('Zip');
    expect(error(() => readSkinPack(pack({ 'ruhe.png': png(1, 1) })))).toContain('skin.json');
    const noIdle = manifest({ states: { done: 'froh' } });
    expect(error(() => readSkinPack(pack({ 'skin.json': strToU8(JSON.stringify(noIdle)) })))).toContain(
      'Format',
    );
    const big = pack({
      'skin.json': strToU8(JSON.stringify(manifest())),
      'ruhe.png': png(600, 600),
      'froh.png': png(1, 1),
    });
    expect(error(() => readSkinPack(big))).toContain('512');
    const jpeg = pack({
      'skin.json': strToU8(JSON.stringify(manifest())),
      'ruhe.png': new Uint8Array([0xff, 0xd8, 0xff, ...new Uint8Array(40)]),
      'froh.png': png(1, 1),
    });
    expect(error(() => readSkinPack(jpeg))).toContain('kein PNG');
    const missing = pack({ 'skin.json': strToU8(JSON.stringify(manifest())), 'ruhe.png': png(1, 1) });
    expect(error(() => readSkinPack(missing))).toContain('froh.png fehlt');
    const unknown = manifest({ idle: ['weg'] });
    expect(error(() => readSkinPack(pack({ 'skin.json': strToU8(JSON.stringify(unknown)) })))).toContain(
      'Format',
    );
  });

  it('reads the size of WebP pictures', () => {
    expect(imageInfo(strToU8('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    const vp8x = new Uint8Array(40);
    vp8x.set(strToU8('RIFF'), 0);
    vp8x.set(strToU8('WEBPVP8X'), 8);
    vp8x.set([255, 0, 0, 127, 0, 0], 24);
    expect(imageInfo(vp8x)).toEqual({ type: 'image/webp', width: 256, height: 128 });
  });

  it('draws pixel art in whole device pixels', () => {
    expect(pixelBox(256, 4, 3)).toMatchObject({ size: 256 / 3 });
    expect(pixelBox(256, 4, 2)).toMatchObject({ size: 64 });
    expect(pixelBox(256, 4, 1)).toMatchObject({ size: 64 });
    expect(pixelBox(512, 1, 1)).toBeNull();
  });
});
