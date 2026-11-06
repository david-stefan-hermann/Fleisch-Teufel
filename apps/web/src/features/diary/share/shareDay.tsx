import { groupDiaryEntries, type ISODate } from '@ft/shared';
import { domToBlob } from 'modern-screenshot';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { UserDb } from '@/db/dexie';
import { loadPhoto } from '@/db/photos';
import { canShareFiles, downloadBlob } from '@/features/reports/export';
import { DayShareImage, type DayShareData } from './DayShareImage';

export const shareDayFileName = (date: ISODate) => `fleisch-teufel_tagebuch_${date}.png`;

const sameOriginFetch = (path: string, init?: RequestInit) =>
  fetch(path, { credentials: 'same-origin', ...init });

/**
 * Adds what the image needs beyond the diary's own data: names and photos of the saved meals of its
 * groups and the first photo of every group as a data URL (an object URL could be gone before the
 * rasterizer fetches it). A photo that cannot be loaded shows the placeholder.
 */
export async function collectShareData(
  db: UserDb,
  base: Omit<DayShareData, 'savedMeals' | 'photos' | 'savedTrainings'>,
): Promise<DayShareData> {
  const groups = base.parts.food ? groupDiaryEntries(base.entries).filter((r) => r.kind === 'group') : [];
  const mealIds = [...new Set(groups.map((g) => g.mealId).filter((id): id is string => !!id))];
  const meals = mealIds.length ? await db.meals.bulkGet(mealIds) : [];
  const savedMeals = new Map(
    meals.filter((m) => !!m).map((m) => [m.id, { name: m.name, photoId: m.photoId ?? null }]),
  );
  const photoIds = new Set<string>();
  for (const g of groups) {
    const id = g.entries[0]?.photoId || (g.mealId && savedMeals.get(g.mealId)?.photoId);
    if (id) photoIds.add(id);
  }
  const photos = new Map<string, string>();
  await Promise.all(
    [...photoIds].map(async (id) => {
      try {
        const blob = await loadPhoto(db, id, sameOriginFetch);
        if (blob) photos.set(id, await dataUrl(blob));
      } catch {
        // Offline or not uploaded yet: the placeholder stands in.
      }
    }),
  );
  const trainingIds = base.parts.training
    ? [...new Set(base.exercises.map((e) => e.templateId).filter((id): id is string => !!id))]
    : [];
  const trainings = trainingIds.length ? await db.exerciseTemplates.bulkGet(trainingIds) : [];
  const savedTrainings = new Map(trainings.filter((t) => !!t).map((t) => [t.id, t.name]));
  return { ...base, savedMeals, photos, savedTrainings };
}

function dataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('Foto konnte nicht gelesen werden.'));
    r.readAsDataURL(blob);
  });
}

const isWebKit = () =>
  /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Android/.test(navigator.userAgent);

/**
 * Renders the day off screen (in the document, so the theme class and fonts apply) and rasterizes
 * it to a PNG at 2 to 3 times the size. WebKit leaves images out of the first rasterization, so
 * there the first result is thrown away.
 */
export async function renderDayImage(data: DayShareData): Promise<Blob> {
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-10000px;top:0;width:390px;pointer-events:none';
  container.setAttribute('aria-hidden', 'true');
  document.body.append(container);
  const root = createRoot(container);
  try {
    flushSync(() => root.render(<DayShareImage data={data} />));
    await document.fonts?.ready;
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await Promise.all(
      [...container.querySelectorAll('img')].map((img) => img.decode().catch(() => undefined)),
    );
    const node = container.firstElementChild as HTMLElement;
    const options = {
      scale: Math.max(2, Math.min(3, window.devicePixelRatio || 2)),
      type: 'image/png' as const,
      backgroundColor: getComputedStyle(node).backgroundColor,
    };
    if (isWebKit()) await domToBlob(node, options);
    const blob = await domToBlob(node, options);
    if (!blob) throw new Error('Das Bild konnte nicht erstellt werden.');
    return blob;
  } finally {
    root.unmount();
    container.remove();
  }
}

export type ShareImageResult = 'shared' | 'aborted' | 'downloaded' | 'needs-tap';

/**
 * Hands the picture to the share sheet, else downloads it (computer). `needs-tap`: the browser
 * wants a fresh tap for the share sheet (iOS after the rasterizing took long), the caller offers a
 * button that calls this again.
 */
export async function shareImage(file: File): Promise<ShareImageResult> {
  if (canShareFiles(file)) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'aborted';
      if (e instanceof DOMException && e.name === 'NotAllowedError') return 'needs-tap';
      // Another failure: the download is the fallback.
    }
  }
  downloadBlob(file.name, file);
  return 'downloaded';
}
