import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { captureInstallPrompt, isDesktop, promptInstall, useInstallState } from '@/app/pwa';

function Probe() {
  const { canPrompt, installed } = useInstallState();
  return <output>{`${canPrompt} ${installed}`}</output>;
}

describe('install prompt', () => {
  it('keeps Chrome’s event, uses it once and notices the install', async () => {
    captureInstallPrompt();
    render(<Probe />);
    expect(screen.getByRole('status').textContent).toBe('false false');
    expect(await promptInstall()).toBe(false); // nothing to show yet

    const prompt = vi.fn(async () => {});
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt,
      userChoice: Promise.resolve({ outcome: 'accepted' as const }),
    });
    act(() => void window.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true); // no mini bar of Chrome
    expect(screen.getByRole('status').textContent).toBe('true false');

    let accepted = false;
    await act(async () => {
      accepted = await promptInstall();
    });
    expect(accepted).toBe(true);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status').textContent).toBe('false false');

    act(() => void window.dispatchEvent(new Event('appinstalled')));
    expect(screen.getByRole('status').textContent).toBe('false true');
  });

  it('counts a wide window with a mouse as a computer', () => {
    const match = (fine: boolean, wide: boolean) =>
      vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('pointer') ? fine : wide }));
    match(true, true);
    expect(isDesktop()).toBe(true);
    match(false, true);
    expect(isDesktop()).toBe(false);
    match(true, false);
    expect(isDesktop()).toBe(false);
    vi.unstubAllGlobals();
  });
});
