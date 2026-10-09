import { useState } from 'react';

/**
 * Start amount of an amount slider: the middle of its range (`sliderRange`). It is the value when
 * the control mounts and stays put while the slider is dragged. Values the control reports itself
 * (`own`) never move it; a value changed from outside (the "Gesamtmenge" slider, a reload of the
 * draft) becomes the new start once no drag runs. `recenter` sets it explicitly (field left, unit
 * switched, −/+ beyond the end).
 */
export function useSliderStart(value: number | null) {
  const [start, setStart] = useState<number | null>(value);
  const [seen, setSeen] = useState(value);
  const [own, setOwn] = useState<number | null | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  if (value !== seen) {
    setSeen(value);
    if (value !== own && !dragging && value !== null && value > 0) setStart(value);
  }
  return {
    start,
    /** Marks a value as coming from this control, so it does not count as an outside change. */
    own: (v: number | null) => setOwn(v),
    /** Pointer down on the slider: the start stays until `endDrag`. */
    startDrag: () => setDragging(true),
    endDrag: () => setDragging(false),
    recenter: (v: number | null) => {
      if (v !== null && v > 0) setStart(v);
    },
  };
}
