import { Scan, Utensils } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Cutlery inside scan-frame corners: one icon for "Essen eintragen" (camera, barcode and search);
 * the frame says scan, the cutlery says food. Lucide has no combined glyph.
 */
export function ScanFoodIcon({ className }: { className?: string }) {
  return (
    <span className={cn('relative inline-grid place-items-center', className)} aria-hidden>
      <Scan className="size-full" strokeWidth={1.75} />
      <Utensils className="absolute size-[52%]" strokeWidth={2.25} />
    </span>
  );
}
