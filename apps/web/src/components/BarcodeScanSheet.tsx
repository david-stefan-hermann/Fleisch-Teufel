import { useCallback, useRef, useState } from 'react';
import { BarcodeScanner, CAM_ERRORS, type ScannerError } from '@/components/BarcodeScanner';
import { FullscreenOverlay } from '@/components/FullscreenOverlay';
import { Button } from '@/components/ui/button';

/**
 * Barcode scan above the custom food editor: the scanner of the food page in a full-screen layer.
 * The first valid code (check digit, read twice) goes to `onDetected`; nothing is looked up.
 */
export function BarcodeScanSheet({
  onDetected,
  onClose,
}: {
  onDetected: (code: string) => void;
  onClose: () => void;
}) {
  const [error, setError] = useState<ScannerError | null>(null);
  const onError = useCallback((e: ScannerError) => setError(e), []);
  // The scanner may report the code again before the parent closes the layer.
  const done = useRef(false);
  return (
    <FullscreenOverlay title="Barcode scannen" onClose={onClose}>
      {error ? (
        <div className="grid gap-4">
          <p role="alert" className="rounded-xl bg-muted p-4 text-sm">
            {CAM_ERRORS[error]} Du kannst den Code im Feld eintippen.
          </p>
          <Button variant="outline" size="lg" onClick={onClose}>
            Schließen
          </Button>
        </div>
      ) : (
        <>
          <BarcodeScanner
            onError={onError}
            onDetected={(code) => {
              if (done.current) return;
              done.current = true;
              onDetected(code);
            }}
          />
          <p className="mt-4 text-center text-sm text-muted-foreground" aria-live="polite">
            Halte den Barcode in den Rahmen.
          </p>
        </>
      )}
    </FullscreenOverlay>
  );
}
