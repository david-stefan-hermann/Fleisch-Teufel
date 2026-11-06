import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/**
 * The diary meal a page logs into, at the right end of its header (`Page actions`): the name with a
 * small arrow, a tap opens the list of meals to pick another one.
 */
export function HeaderMealPicker({
  meal,
  names,
  onChange,
  disabled,
}: {
  meal: number;
  names: readonly string[];
  onChange: (meal: number) => void;
  disabled?: boolean;
}) {
  const name = names[meal];
  // Settings still loading: no meal to name yet.
  if (name === undefined) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          disabled={disabled}
          aria-label={`Mahlzeit: ${name}`}
          className="max-w-[45vw] gap-1 px-2 font-normal text-muted-foreground has-[>svg]:px-2"
        >
          <span className="truncate">{name}</span>
          <ChevronDown className="size-4" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        <DropdownMenuRadioGroup value={String(meal)} onValueChange={(v) => onChange(Number(v))}>
          {names.map((n, i) => (
            <DropdownMenuRadioItem key={i} value={String(i)} className="min-h-11">
              {n}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
