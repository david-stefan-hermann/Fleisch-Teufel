/** The figure the button wears on this device (Mehr → Aussehen): standard, built in or uploaded. */
import type { SkinManifest } from '@ft/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useDb } from '@/app/session';
import type { AssistantSkin } from '@/db/dexie';
import { useAppearance } from '@/lib/appearance';
import { BUILTIN_SKINS, type BuiltinSkin } from './builtin';
import { pixelBox, STANDARD_SKIN, type SkinView } from './SkinFace';

const dpr = () => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);

/** The view of a pack: its manifest, picture URLs and, for pixel art, the place of the picture. */
export function skinView(
  id: string,
  manifest: SkinManifest,
  urls: Record<string, string>,
  pixel: { width: number; grid: number } | null,
  ratio = dpr(),
): SkinView {
  return {
    id,
    name: manifest.name,
    style: manifest.style,
    kind: 'pictures',
    manifest,
    urls,
    pixel: manifest.pixelArt && pixel ? pixelBox(pixel.width, pixel.grid, ratio) : null,
  };
}

/** `scale`: the button's size factor (pixel art then stays on whole device pixels). */
export function builtinView(b: BuiltinSkin, scale = 1): SkinView {
  return skinView(b.id, b.manifest, b.urls, b.grid ? { width: 256, grid: b.grid } : null, dpr() * scale);
}

/**
 * Object URLs of an uploaded pack's pictures (key → URL), made in an effect and revoked with it
 * (StrictMode-safe like `useObjectUrl`).
 */
export function useSkinUrls(skin: AssistantSkin | undefined): Record<string, string> | null {
  const [held, setHeld] = useState<{ id: string; urls: Record<string, string> } | null>(null);
  const id = skin?.id;
  useEffect(() => {
    if (!skin) return;
    const urls: Record<string, string> = {};
    for (const [key, file] of Object.entries(skin.manifest.images)) {
      const img = skin.images[file];
      if (img) urls[key] = URL.createObjectURL(new Blob([img.bytes], { type: img.type }));
    }
    // Syncing an external resource (the object URLs) into state is what this effect is for.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHeld({ id: skin.id, urls });
    return () => Object.values(urls).forEach((u) => URL.revokeObjectURL(u));
    // The pack never changes under its id (a new upload gets a new id).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  return held && held.id === id ? held.urls : null;
}

/** The chosen figure for a button drawn `scale` times its size. */
export function useSkin(scale = 1): SkinView {
  const db = useDb();
  const { assistantSkin } = useAppearance();
  const builtin = BUILTIN_SKINS.find((b) => b.id === assistantSkin);
  const uploaded = useLiveQuery(
    () => (assistantSkin === 'standard' || builtin ? undefined : db.assistantSkins.get(assistantSkin)),
    [db, assistantSkin, builtin],
  );
  const urls = useSkinUrls(uploaded);
  if (builtin) return builtinView(builtin, scale);
  if (uploaded && urls)
    return skinView(uploaded.id, uploaded.manifest, urls, { width: uploaded.width, grid: 1 }, dpr() * scale);
  return STANDARD_SKIN;
}
