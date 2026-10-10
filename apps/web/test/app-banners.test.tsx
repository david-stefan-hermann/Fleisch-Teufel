import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The banners read session, update and install state from modules; the tests set them directly.
const env = {
  needsReauth: false,
  updateReady: false,
  standalone: false,
  ios: false,
  android: false,
  desktop: false,
  canPrompt: false,
  installed: false,
};
const promptInstall = vi.fn(async () => true);

vi.mock('@/app/session', () => ({ useSessionContext: () => ({ needsReauth: env.needsReauth }) }));
vi.mock('@/app/pwa', () => ({
  applyUpdate: vi.fn(),
  useUpdateReady: () => env.updateReady,
  isStandalone: () => env.standalone,
  isIos: () => env.ios,
  isAndroid: () => env.android,
  isDesktop: () => env.desktop,
  useInstallState: () => ({ canPrompt: env.canPrompt, installed: env.installed }),
  promptInstall: () => promptInstall(),
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const { AppBanners, INSTALL_DELAY_MS, INSTALL_DISMISSED_KEY } = await import('@/app/AppBanners');

const installButton = () => screen.queryByRole('button', { name: /^(Installieren|Aufs Handy)$/ });

describe('install banner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.assign(env, {
      needsReauth: false,
      updateReady: false,
      standalone: false,
      ios: false,
      android: false,
      desktop: false,
      canPrompt: false,
      installed: false,
    });
    localStorage.clear();
    promptInstall.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('slides in 3 s after the start on the iPhone and shows the Safari steps', () => {
    env.ios = true;
    render(<AppBanners />);
    act(() => void vi.advanceTimersByTime(INSTALL_DELAY_MS - 1));
    expect(installButton()).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(screen.getByText('Fleisch-Teufel')).toBeTruthy();
    expect(screen.getByText('Kostenlos, ohne App Store')).toBeTruthy();
    fireEvent.click(installButton()!);
    const dialog = screen.getByRole('dialog', { name: 'Zum Home-Bildschirm hinzufügen' });
    expect(dialog.textContent).toContain('„Zum Home-Bildschirm“');
    expect(dialog.textContent).toContain('„Hinzufügen“');
    fireEvent.click(screen.getByRole('button', { name: 'Verstanden' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never shows in the installed app', () => {
    env.ios = true;
    env.standalone = true;
    render(<AppBanners />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(installButton()).toBeNull();
  });

  it('closing hides it for good on this device', () => {
    env.android = true;
    const { unmount } = render(<AppBanners />);
    act(() => void vi.advanceTimersByTime(INSTALL_DELAY_MS));
    fireEvent.click(screen.getByRole('button', { name: 'Hinweis schließen' }));
    expect(installButton()).toBeNull();
    expect(localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe('1');
    unmount();
    render(<AppBanners />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(installButton()).toBeNull();
  });

  it('opens Chrome’s install dialog on Android, or the menu steps without it', () => {
    env.android = true;
    env.canPrompt = true;
    const { unmount } = render(<AppBanners />);
    act(() => void vi.advanceTimersByTime(INSTALL_DELAY_MS));
    fireEvent.click(installButton()!);
    expect(promptInstall).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();

    env.canPrompt = false;
    render(<AppBanners />);
    act(() => void vi.advanceTimersByTime(INSTALL_DELAY_MS));
    fireEvent.click(installButton()!);
    expect(promptInstall).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('dialog', { name: 'App installieren' }).textContent).toContain(
      '„App installieren“',
    );
  });

  it('on a computer it leads to the phone with a QR code of the app', () => {
    env.desktop = true;
    env.canPrompt = true; // desktop Chrome could install, but the app is meant for the phone
    render(<AppBanners />);
    act(() => void vi.advanceTimersByTime(INSTALL_DELAY_MS));
    expect(screen.getByText('Als App aufs Handy holen, kostenlos')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Aufs Handy' }));
    expect(promptInstall).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog', { name: 'Fleisch-Teufel aufs Handy holen' });
    const qr = screen.getByRole('img', { name: `QR-Code: ${window.location.origin}/` });
    expect(dialog.contains(qr)).toBe(true);
    expect(qr.querySelector('path')?.getAttribute('d')).toMatch(/^M\d/);
  });

  it('shows nowhere else unless the browser can install', () => {
    render(<AppBanners />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(installButton()).toBeNull();
  });

  it('shows one banner at a time and waits while another one is up', () => {
    env.ios = true;
    env.updateReady = true;
    const { rerender } = render(<AppBanners />);
    act(() => void vi.advanceTimersByTime(10_000));
    expect(screen.getByText('Eine neue Version ist da.')).toBeTruthy();
    expect(installButton()).toBeNull();
    expect(screen.getAllByRole('status')).toHaveLength(1);

    // The session banner goes first, also before the update.
    env.needsReauth = true;
    rerender(<AppBanners />);
    expect(screen.getByText(/Sitzung ist abgelaufen/)).toBeTruthy();
    expect(screen.queryByText('Eine neue Version ist da.')).toBeNull();

    // Once nothing else is up, the 3 s start.
    env.needsReauth = false;
    env.updateReady = false;
    rerender(<AppBanners />);
    act(() => void vi.advanceTimersByTime(INSTALL_DELAY_MS - 1));
    expect(installButton()).toBeNull();
    act(() => void vi.advanceTimersByTime(1));
    expect(installButton()).toBeTruthy();
    expect(screen.getAllByRole('status')).toHaveLength(1);
  });

  it('disappears once the app got installed', () => {
    env.android = true;
    const { rerender } = render(<AppBanners />);
    act(() => void vi.advanceTimersByTime(INSTALL_DELAY_MS));
    expect(installButton()).toBeTruthy();
    env.installed = true;
    rerender(<AppBanners />);
    expect(installButton()).toBeNull();
  });
});
