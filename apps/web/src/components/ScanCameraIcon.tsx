import { Camera, Scan } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Camera inside scan-frame corners: one icon for "photo or barcode" (lucide has no combined glyph). */
export function ScanCameraIcon({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-grid place-items-center', className)} aria-hidden>
      <Scan className="size-full" strokeWidth={1.75} />
      <Camera className="absolute size-[52%]" strokeWidth={2.25} />
    </span>
  );
}
