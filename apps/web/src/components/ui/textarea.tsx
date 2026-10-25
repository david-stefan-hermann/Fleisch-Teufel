import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Sets the height to the content where the browser cannot (`field-sizing: content` is missing in
 * older iOS Safari); a `max-height` in CSS still caps it, then the field scrolls.
 */
function grow(el: HTMLTextAreaElement) {
  if (typeof CSS !== 'undefined' && CSS.supports?.('field-sizing', 'content')) return;
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
}

function Textarea({
  className,
  autoGrow = false,
  ref,
  onInput,
  ...props
}: React.ComponentProps<'textarea'> & {
  /** Grow with the text also without `field-sizing` support (typing and values set from outside). */
  autoGrow?: boolean;
}) {
  const own = React.useRef<HTMLTextAreaElement | null>(null);
  React.useLayoutEffect(() => {
    if (autoGrow && own.current) grow(own.current);
  }, [autoGrow, props.value]);
  return (
    <textarea
      data-slot="textarea"
      ref={(el) => {
        own.current = el;
        if (typeof ref === 'function') return ref(el);
        if (ref) ref.current = el;
      }}
      onInput={(e) => {
        if (autoGrow) grow(e.currentTarget);
        onInput?.(e);
      }}
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:aria-invalid:ring-destructive/40',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
