import { X } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PageFooter } from '@/components/PageFooter';
import { Button } from '@/components/ui/button';

/**
 * Full-screen layer above the current page (barcode scan and label photos in the custom food
 * editor): own header with the title and an X, content, optional sticky footer. The page below
 * stays mounted with its form state. Escape and the X call `onClose`; focus starts on the X and
 * returns to where it was.
 */
export function FullscreenOverlay({
  title,
  onClose,
  closeLabel = 'Schließen',
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  closeLabel?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const titleId = useId();
  const close = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    close.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, []);
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto overscroll-contain bg-background"
    >
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/85 pt-[var(--safe-top)] backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-1 px-2">
          <span className="w-2" />
          <h1 id={titleId} className="min-w-0 flex-1 truncate text-lg font-semibold tracking-tight">
            {title}
          </h1>
          <Button ref={close} variant="ghost" size="icon" onClick={onClose} aria-label={closeLabel}>
            <X className="size-6" aria-hidden />
          </Button>
        </div>
      </header>
      <main
        className={
          footer
            ? 'mx-auto w-full max-w-xl flex-1 px-4 pt-4 pb-4'
            : 'mx-auto w-full max-w-xl flex-1 px-4 pt-4 pb-[calc(var(--safe-bottom)+1.5rem)]'
        }
      >
        {children}
      </main>
      {footer && <PageFooter>{footer}</PageFooter>}
    </div>,
    document.body,
  );
}
