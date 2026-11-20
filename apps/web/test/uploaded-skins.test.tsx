import { uuidv7 } from '@ft/shared';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserDb } from '@/db/dexie';
import { UploadedSkins } from '@/features/assistant/skins/UploadedSkins';
import { setAssistantSkin } from '@/lib/appearance';

vi.mock('@/app/session', () => ({ useDb: () => sessionDb }));
vi.mock('@/features/assistant/skins/uploads', async (orig) => ({
  ...(await orig<typeof import('@/features/assistant/skins/uploads')>()),
  listServerSkins: () =>
    Promise.resolve([{ id: 'pack-1', name: 'Testfigur', bytes: 1, createdAt: '2026-11-20T10:00:00Z' }]),
}));
let sessionDb: UserDb;

/** The header of a PNG of the given size (enough for the pack checks). */
const png = (w: number, h: number) => {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  b.set(strToU8('IHDR'), 12);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};
const zip = zipSync({
  'skin.json': strToU8(
    JSON.stringify({
      format: 'fleisch-teufel-skin',
      version: 1,
      name: 'Testfigur',
      style: 'free',
      images: { ruhe: 'ruhe.png' },
      states: { idle: 'ruhe' },
    }),
  ),
  'ruhe.png': png(256, 256),
});

let fetches = 0;
// Holds the download until the test lets it go (null: answers at once).
let gate: Promise<void> | null = null;
beforeEach(() => {
  gate = null;
  sessionDb = new UserDb(`s-${uuidv7()}`);
  setAssistantSkin('standard');
  localStorage.clear();
  fetches = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => {
      fetches++;
      await gate;
      return new Response(zip, { status: 200 });
    }),
  );
  let n = 0;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('uploaded figures known only from the server', () => {
  it('show their pictures without a tap; a tap only chooses', async () => {
    const { container } = render(<UploadedSkins />);
    await waitFor(() => expect(container.querySelector('img[src^="blob:test/"]')).not.toBeNull());
    expect(fetches).toBe(1);
    expect(localStorage.getItem('ft.assistant.skin')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Testfigur/, pressed: false }));
    await waitFor(() => expect(localStorage.getItem('ft.assistant.skin')).toBe('pack-1'));
    expect(fetches).toBe(1);
  });

  it('a tap while the pack loads waits for the same download and chooses it', async () => {
    let open!: () => void;
    gate = new Promise((r) => (open = r));
    render(<UploadedSkins />);
    const tile = await screen.findByRole('button', { name: /Testfigur/, pressed: false });
    await waitFor(() => expect(fetches).toBe(1));
    fireEvent.click(tile);
    open();
    await waitFor(() => expect(localStorage.getItem('ft.assistant.skin')).toBe('pack-1'));
    expect(fetches).toBe(1);
  });
});
