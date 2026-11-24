import { ChevronDown, ChevronRight } from 'lucide-react';
import { Slot } from 'radix-ui';
import type { ComponentProps, ReactNode } from 'react';
import { CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';

/*
 * The one design language for everything tappable that is not a Button (plan
 * docs/plans/2026-11-bedienelemente.md). Highlights outside components/ui come only from here; a lint
 * rule refuses `hover:bg-accent` and `underline` anywhere else.
 */

/** Row of a list that opens a page or logs: borderless, 56 px, pointer `bg-accent/60`, focus `bg-accent`. */
export const rowClass =
  'flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/60 focus-visible:bg-accent focus-visible:outline-none';

/** `rowClass` for a row whose stretched link is the focus target. */
export const rowWithLinkClass =
  'flex min-h-14 items-center gap-3 px-4 py-2 transition-colors hover:bg-accent/60 has-[a:focus-visible]:bg-accent';

/** The dashed "hinzufügen" areas of the diary cards. */
export const dashedAddClass =
  'flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-input text-sm font-medium text-muted-foreground transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

/** Pointer highlight of chips, choice cards, tiles and the week strip (each its own kind of control). */
export const choiceHoverClass = 'hover:bg-accent';

function Arrow({ icon }: { icon: 'right' | 'down' }) {
  return icon === 'right' ? (
    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
  ) : (
    <ChevronDown
      className="size-4 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180 group-data-[state=open]:rotate-180 motion-reduce:transition-none"
      aria-hidden
    />
  );
}

const footerRowClass =
  'group flex min-h-11 w-full items-center justify-between gap-3 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none';

/**
 * Footer and disclosure row: at the bottom of a card or within content, it goes on. No background
 * ever; the arrow sits at the right end (right = a page, down = opens and turns). No own side
 * padding: directly in a `Section` pass `className="px-4"`.
 */
export function FooterRow({
  children,
  icon,
  className,
  asChild,
  ...props
}: ComponentProps<'button'> & { icon: 'right' | 'down'; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      {...(asChild ? {} : { type: 'button' as const })}
      className={cn(footerRowClass, className)}
      {...props}
    >
      <Slot.Slottable>{children}</Slot.Slottable>
      <Arrow icon={icon} />
    </Comp>
  );
}

/** `FooterRow` as the trigger of a `Collapsible`. */
export function DisclosureRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <CollapsibleTrigger className={cn(footerRowClass, className)}>
      <span>{children}</span>
      <Arrow icon="down" />
    </CollapsibleTrigger>
  );
}

/** Head of a collapsible section: the card title is the switch, the whole head row is tappable. */
export function SectionToggle({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <CollapsibleTrigger
      className={cn(
        'group flex min-h-12 w-full items-center justify-between gap-2 px-4 text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none focus-visible:ring-inset',
        className,
      )}
    >
      <h2 className="text-base font-semibold">{children}</h2>
      <Arrow icon="down" />
    </CollapsibleTrigger>
  );
}

/** A word or value in a header that is tappable: a 32 px box, tap area 44 px. */
export const inlineTargetClass =
  'relative inline-flex h-8 items-center rounded-lg px-2 -mx-2 transition-colors hover:bg-accent/60 aria-expanded:bg-accent data-[state=open]:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none after:absolute after:-inset-y-1.5 after:inset-x-0';

export function InlineTarget({
  className,
  asChild,
  ...props
}: ComponentProps<'button'> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      {...(asChild ? {} : { type: 'button' as const })}
      className={cn(inlineTargetClass, className)}
      {...props}
    />
  );
}

/** Text that does something: underlined, red or grey; `inline` inherits the size of its sentence. */
export function textLinkClass({
  tone = 'primary',
  inline,
}: { tone?: 'primary' | 'quiet'; inline?: boolean } = {}) {
  return cn(
    'font-medium underline underline-offset-2 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none rounded-sm',
    !inline && 'text-sm',
    tone === 'primary' ? 'text-primary' : 'text-muted-foreground transition-colors hover:text-foreground',
  );
}

export function TextLink({
  tone,
  inline,
  className,
  asChild,
  ...props
}: ComponentProps<'button'> & { tone?: 'primary' | 'quiet'; inline?: boolean; asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button';
  return (
    <Comp
      {...(asChild ? {} : { type: 'button' as const })}
      className={cn(textLinkClass({ tone, inline }), className)}
      {...props}
    />
  );
}
