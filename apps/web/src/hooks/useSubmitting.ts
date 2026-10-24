import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/api';

/**
 * Guards a submit handler against a second tap while the first one still runs (a double tap on
 * "eintragen" used to write two entries): `run(fn)` ignores calls while busy, `busy` disables the
 * button. A failure (storage full, invalid record) ends in a toast instead of an unhandled rejection.
 * The ref decides (two taps in one frame see the same render), the state renders.
 */
export function useSubmitting() {
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    setBusy(true);
    try {
      return await fn();
    } catch (e) {
      toast.error(errorMessage(e));
      return undefined;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, run };
}
