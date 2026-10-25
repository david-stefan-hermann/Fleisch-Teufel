import { MAX_HINT_LENGTH } from '@ft/shared';
import type * as React from 'react';
import { Textarea } from '@/components/ui/textarea';
import { fmt0 } from '@/lib/format';

/**
 * The hint (or description) of a meal analysis: one line while empty, growing with the text up to
 * about six lines, then it scrolls. Enter starts a new line; analysing is a button.
 */
export function HintField(
  props: Omit<React.ComponentProps<typeof Textarea>, 'rows' | 'maxLength' | 'autoGrow'>,
) {
  return (
    <Textarea
      rows={1}
      maxLength={MAX_HINT_LENGTH}
      autoGrow
      autoComplete="off"
      {...props}
      className="min-h-11 resize-none max-h-40"
    />
  );
}

/** "N von 1.000 Zeichen" once the text is near the limit, so cutting off is no surprise. */
export function HintCount({ length }: { length: number }) {
  if (length < MAX_HINT_LENGTH * 0.8) return null;
  return (
    <span className="tabular block">
      {fmt0(length)} von {fmt0(MAX_HINT_LENGTH)} Zeichen
    </span>
  );
}
