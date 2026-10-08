import type { NutrientMap } from '@ft/shared';
import type { ReactNode } from 'react';
import {
  DisclosureTrigger,
  NutrientBreakdown,
  type NutrientBreakdownProps,
} from '@/components/NutrientBreakdown';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

/**
 * "Nährwerte" at the bottom of an ingredient card (meal editor, AI review): a divider and a
 * collapsed trigger that opens the one nutrient overview for the ingredient's amount. Sits flush
 * with the card edges, so the card keeps its `p-4`.
 */
export function NutrientsDisclosure({
  nutrients,
  targets,
  title,
  open,
  onOpenChange,
  className,
}: {
  nutrients: NutrientMap;
  targets: NutrientBreakdownProps['targets'];
  /** The amount, e.g. "100 g" or "1 Stück (10 g)"; shown left of the kcal. */
  title: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className={cn('-mx-4 -mb-4 border-t border-border/70 px-4', className)}
    >
      <DisclosureTrigger className="min-h-11 text-sm font-semibold">Nährwerte</DisclosureTrigger>
      <CollapsibleContent className="pt-1 pb-3">
        <NutrientBreakdown title={title} nutrients={nutrients} targets={targets} />
      </CollapsibleContent>
    </Collapsible>
  );
}
