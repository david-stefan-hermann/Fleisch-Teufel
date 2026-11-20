import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  canTapFocus,
  coverPoint,
  FOCUS_HOLD_MS,
  focusAt,
  logCameraInfo,
  pickMainCamera,
  startAutofocus,
  stopFocus,
} from '@/components/cameraFocus';

/** A fake video track reporting `caps` (or no getCapabilities at all). */
function fakeTrack(caps: Record<string, unknown> | null, refuse = false) {
  const applyConstraints = vi.fn(() =>
    refuse ? Promise.reject(new Error('OverconstrainedError')) : Promise.resolve(),
  );
  const track = { applyConstraints, ...(caps ? { getCapabilities: () => caps } : {}) };
  return { track: track as unknown as MediaStreamTrack, applyConstraints };
}

describe('camera focus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getSupportedConstraints: () => ({ pointsOfInterest: true }) },
      configurable: true,
    });
  });
  afterEach(() => vi.useRealTimers());

  it('sets continuous focus when the camera reports it', async () => {
    const { track, applyConstraints } = fakeTrack({ focusMode: ['manual', 'single-shot', 'continuous'] });
    await startAutofocus(track);
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ focusMode: 'continuous' }] });
    expect(canTapFocus(track)).toBe(true);
  });

  it('does nothing without focus modes or without getCapabilities (iPhone)', async () => {
    for (const { track, applyConstraints } of [fakeTrack({}), fakeTrack(null)]) {
      await startAutofocus(track);
      expect(applyConstraints).not.toHaveBeenCalled();
      expect(canTapFocus(track)).toBe(false);
    }
  });

  it('needs pointsOfInterest for a tap', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getSupportedConstraints: () => ({}) },
      configurable: true,
    });
    expect(canTapFocus(fakeTrack({ focusMode: ['continuous'] }).track)).toBe(false);
  });

  it('a refused constraint is no error', async () => {
    const { track } = fakeTrack({ focusMode: ['continuous'] }, true);
    await expect(startAutofocus(track)).resolves.toBeUndefined();
    await expect(focusAt(track, { x: 0.5, y: 0.5 })).resolves.toBeUndefined();
  });

  it('a tap focuses once at the point, then continuously again', async () => {
    const { track, applyConstraints } = fakeTrack({ focusMode: ['single-shot', 'continuous'] });
    await focusAt(track, { x: 0.2, y: 0.7 });
    expect(applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ pointsOfInterest: [{ x: 0.2, y: 0.7 }], focusMode: 'single-shot' }],
    });
    await vi.advanceTimersByTimeAsync(FOCUS_HOLD_MS - 10);
    expect(applyConstraints).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(20);
    expect(applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ focusMode: 'continuous' }] });
  });

  it('without single-shot the point goes with continuous; stopping drops the return', async () => {
    const { track, applyConstraints } = fakeTrack({ focusMode: ['continuous'] });
    await focusAt(track, { x: 0.5, y: 0.5 });
    expect(applyConstraints).toHaveBeenLastCalledWith({
      advanced: [{ pointsOfInterest: [{ x: 0.5, y: 0.5 }], focusMode: 'continuous' }],
    });
    stopFocus(track);
    await vi.advanceTimersByTimeAsync(FOCUS_HOLD_MS + 10);
    expect(applyConstraints).toHaveBeenCalledTimes(1);
  });

  it('a second tap restarts the hold; an ended track is left alone', async () => {
    const { track, applyConstraints } = fakeTrack({ focusMode: ['continuous'] });
    // Both taps start before the camera answered the first one.
    void focusAt(track, { x: 0.1, y: 0.1 });
    await vi.advanceTimersByTimeAsync(3000);
    await focusAt(track, { x: 0.9, y: 0.9 });
    await vi.advanceTimersByTimeAsync(FOCUS_HOLD_MS - 1000);
    expect(applyConstraints).toHaveBeenCalledTimes(2);
    (track as { readyState?: string }).readyState = 'ended';
    await vi.advanceTimersByTimeAsync(2000);
    expect(applyConstraints).toHaveBeenCalledTimes(2);
  });

  it('maps a tap through object-cover', () => {
    // A 4:3 landscape video in a 3:4 portrait box: the sides are cut off.
    const wide = { boxW: 300, boxH: 400, videoW: 1920, videoH: 1440 };
    expect(coverPoint({ ...wide, x: 150, y: 200 })).toEqual({ x: 0.5, y: 0.5 });
    // Scale 400/1440: the video is 533.3 px wide, 116.7 px cut on each side.
    const left = coverPoint({ ...wide, x: 0, y: 0 });
    expect(left.x).toBeCloseTo(116.67 / 533.33, 3);
    expect(left.y).toBe(0);
    // A tall video in a wide box: top and bottom are cut off.
    const tall = coverPoint({ boxW: 400, boxH: 300, videoW: 1440, videoH: 1920, x: 400, y: 300 });
    expect(tall.x).toBe(1);
    expect(tall.y).toBeCloseTo((300 + (533.33 - 300) / 2) / 533.33, 3);
  });
});

describe('camera info in the error log', () => {
  const device = (label: string, deviceId = label) =>
    ({ kind: 'videoinput', label, deviceId, groupId: '' }) as MediaDeviceInfo;
  const track = (label: string) =>
    ({
      label,
      getCapabilities: () => ({ focusMode: ['continuous'], focusDistance: { min: 0.1, max: 10 } }),
      getSettings: () => ({ deviceId: 'abcdef123456' }),
    }) as unknown as MediaStreamTrack;
  const devices = (list: MediaDeviceInfo[]) =>
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { enumerateDevices: () => Promise.resolve(list) },
      configurable: true,
    });
  beforeEach(() => localStorage.clear());

  it('writes one line per camera label when there are several back cameras', async () => {
    devices([
      device('camera2 0, facing back'),
      device('camera2 2, facing back'),
      device('camera2 1, facing front'),
    ]);
    const log = vi.fn();
    await logCameraInfo(track('camera2 2, facing back'), log);
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]![0] as string;
    expect(line).toContain('Kamera: camera2 2, facing back (abcdef12)');
    expect(line).toContain('focusMode: ["continuous"]');
    expect(line).toContain('focusDistance: {"min":0.1,"max":10}');
    expect(line).toContain('camera2 0, facing back | camera2 2, facing back | camera2 1, facing front');
    await logCameraInfo(track('camera2 2, facing back'), log);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('stays quiet with one back camera', async () => {
    devices([device('Back Camera'), device('Front Camera')]);
    const log = vi.fn();
    await logCameraInfo(track('Back Camera'), log);
    expect(log).not.toHaveBeenCalled();
  });
});

describe('main camera', () => {
  const cam = (label: string, deviceId: string, kind: MediaDeviceKind = 'videoinput') =>
    ({ kind, label, deviceId, groupId: '' }) as MediaDeviceInfo;
  const android = [
    cam('camera2 1, facing front', 'front'),
    cam('camera2 0, facing back', 'main'),
    cam('camera2 2, facing back', 'wide'),
    cam('camera2 3, facing back', 'tele'),
  ];

  it('one back camera: nothing to switch', () => {
    expect(pickMainCamera([cam('camera2 0, facing back', 'main'), android[0]!], 'main')).toBeNull();
  });

  it('the main camera runs already: nothing to switch', () => {
    expect(pickMainCamera(android, 'main')).toBeNull();
  });

  it('another back camera runs: the lowest number', () => {
    expect(pickMainCamera(android, 'wide')).toBe('main');
    expect(pickMainCamera(android, undefined)).toBe('main');
  });

  it('labels without the pattern and empty labels before the permission: nothing', () => {
    expect(pickMainCamera([cam('Back Camera', 'a'), cam('Back Ultra Wide Camera', 'b')], 'b')).toBeNull();
    expect(pickMainCamera([cam('', 'a'), cam('', 'b')], 'b')).toBeNull();
    expect(
      pickMainCamera([cam('camera2 0, facing back', 'a', 'audioinput'), android[2]!], 'wide'),
    ).toBeNull();
  });
});
