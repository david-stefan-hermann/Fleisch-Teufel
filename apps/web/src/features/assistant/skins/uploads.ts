/**
 * Uploaded figures live in the account (server) and as a copy on each device. Uploading checks the
 * pack first; other devices load the list when the appearance page opens and a pack once it is chosen.
 */
import { uuidv7, type SkinInfo } from '@ft/shared';
import type { AssistantSkin, UserDb } from '@/db/dexie';
import { api, ApiError, OfflineError } from '@/lib/api';
import { readSkinPack } from './pack';

export async function uploadSkin(db: UserDb, file: Blob): Promise<AssistantSkin> {
  const zip = new Uint8Array(await file.arrayBuffer());
  const pack = readSkinPack(zip);
  const id = uuidv7();
  await api(`/api/assistant/skins/${id}?name=${encodeURIComponent(pack.manifest.name)}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/zip' },
    body: zip,
    timeoutMs: 60_000,
  });
  const skin: AssistantSkin = {
    id,
    name: pack.manifest.name,
    manifest: pack.manifest,
    images: pack.images,
    width: pack.width,
    bytes: zip.length,
    createdAt: Date.now(),
  };
  await db.assistantSkins.put(skin);
  return skin;
}

export async function listServerSkins(): Promise<SkinInfo[]> {
  return (await api<{ skins: SkinInfo[] }>('/api/assistant/skins', { timeoutMs: 10_000 })).skins;
}

/** Loads a pack of the account onto this device (raw fetch: the body is a zip, not JSON). */
export async function downloadSkin(db: UserDb, info: SkinInfo): Promise<AssistantSkin> {
  let res: Response;
  try {
    res = await fetch(`/api/assistant/skins/${encodeURIComponent(info.id)}`, { credentials: 'same-origin' });
  } catch {
    throw new OfflineError();
  }
  if (!res.ok) throw new ApiError(res.status, res.status === 404 ? 'not_found' : `http_${res.status}`);
  const zip = new Uint8Array(await res.arrayBuffer());
  const pack = readSkinPack(zip);
  const skin: AssistantSkin = {
    id: info.id,
    name: pack.manifest.name,
    manifest: pack.manifest,
    images: pack.images,
    width: pack.width,
    bytes: zip.length,
    createdAt: Date.parse(info.createdAt) || Date.now(),
  };
  await db.assistantSkins.put(skin);
  return skin;
}

export async function deleteSkin(db: UserDb, id: string): Promise<void> {
  await api(`/api/assistant/skins/${encodeURIComponent(id)}`, { method: 'DELETE', timeoutMs: 10_000 });
  await db.assistantSkins.delete(id);
}

/** Copies of packs the account no longer has (deleted on another device) leave this device too. */
export async function dropRemovedSkins(db: UserDb, server: readonly SkinInfo[]): Promise<void> {
  const keep = new Set(server.map((s) => s.id));
  const gone = (await db.assistantSkins.toCollection().primaryKeys()).filter((id) => !keep.has(String(id)));
  if (gone.length) await db.assistantSkins.bulkDelete(gone);
}
