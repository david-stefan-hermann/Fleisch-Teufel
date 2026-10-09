import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMERA_CONSTRAINTS,
  cancelWarmUp,
  takeWarmStream,
  WARM_MS,
  warmUpCamera,
} from '@/components/cameraWarmup';

/** A fake stream with one video track that records `stop()`. */
function fakeStream() {
  const track = { readyState: 'live' as MediaStreamTrackState, stop: vi.fn() };
  track.stop.mockImplementation(() => {
    track.readyState = 'ended';
  });
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

describe('camera warm-up', () => {
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true });
  });

  afterEach(() => {
    cancelWarmUp();
    vi.useRealTimers();
  });

  it('asks once with the scanner constraints and hands the stream out once', async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    warmUpCamera();
    warmUpCamera(); // a second tap does not start the camera twice
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith(CAMERA_CONSTRAINTS);
    expect(await takeWarmStream()).toBe(stream);
    expect(await takeWarmStream()).toBeNull();
    // Picked up: the timer no longer stops it.
    await vi.advanceTimersByTimeAsync(WARM_MS + 100);
    expect(track.stop).not.toHaveBeenCalled();
  });

  it('stops a stream nobody picked up after WARM_MS', async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    warmUpCamera();
    await vi.advanceTimersByTimeAsync(WARM_MS - 100);
    expect(track.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(await takeWarmStream()).toBeNull();
    // After the stop a new tap may warm up again.
    warmUpCamera();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
  });

  it('stops a stream that arrives only after the timeout', async () => {
    const { stream, track } = fakeStream();
    let resolve!: (s: MediaStream) => void;
    getUserMedia.mockReturnValue(new Promise<MediaStream>((r) => (resolve = r)));
    warmUpCamera();
    await vi.advanceTimersByTimeAsync(WARM_MS + 10);
    resolve(stream); // e.g. the permission prompt was answered late
    await vi.advanceTimersByTimeAsync(0);
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it('a failed warm-up yields null, so the scanner asks itself', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'));
    warmUpCamera();
    expect(await takeWarmStream()).toBeNull();
  });

  it('an ended stream is not handed out', async () => {
    const { stream, track } = fakeStream();
    getUserMedia.mockResolvedValue(stream);
    warmUpCamera();
    track.readyState = 'ended';
    expect(await takeWarmStream()).toBeNull();
  });

  it('without a warm-up there is nothing to take', async () => {
    expect(await takeWarmStream()).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('does nothing without camera support', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { value: undefined, configurable: true });
    expect(() => warmUpCamera()).not.toThrow();
    expect(await takeWarmStream()).toBeNull();
  });
});
