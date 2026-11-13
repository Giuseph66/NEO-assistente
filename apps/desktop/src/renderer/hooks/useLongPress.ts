import { useEffect, useRef } from 'react';

export const LONG_PRESS_MS = 450;

/**
 * Tap vs hold on one button, without depending on React (unit tested).
 *
 * down() starts the hold timer; if it fires, onLongPress runs and the click that
 * the browser sends on release is swallowed. A release before the timer is a tap.
 * Leaving the button or a cancelled pointer aborts both.
 */
export class LongPressTracker {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private suppressClick = false;
  private pressing = false;

  constructor(
    private readonly handlers: { onTap: () => void; onLongPress: () => void; onHoldChange?: (holding: boolean) => void },
    private readonly delay = LONG_PRESS_MS
  ) {}

  down(): void {
    this.cancel();
    this.pressing = true;
    this.suppressClick = false;
    this.handlers.onHoldChange?.(true);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.pressing = false;
      this.suppressClick = true;
      this.handlers.onHoldChange?.(false);
      this.handlers.onLongPress();
    }, this.delay);
  }

  /** Pointer released over the button: the browser follows with a click. */
  up(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pressing) {
      this.pressing = false;
      this.handlers.onHoldChange?.(false);
    }
  }

  /** Pointer left the button or was cancelled: neither tap nor hold. */
  cancel(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    // Released elsewhere, so no click follows: never leave a stale suppression behind
    // (it would swallow the next keyboard Enter/Space).
    this.suppressClick = false;
    if (this.pressing) {
      this.pressing = false;
      this.handlers.onHoldChange?.(false);
    }
  }

  /** The click event (mouse release or keyboard Enter/Space). */
  click(): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    this.handlers.onTap();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

export function useLongPress(options: {
  onTap: () => void;
  onLongPress: () => void;
  onHoldChange?: (holding: boolean) => void;
  delay?: number;
}) {
  const latest = useRef(options);
  latest.current = options;
  const trackerRef = useRef<LongPressTracker | null>(null);
  if (!trackerRef.current) {
    trackerRef.current = new LongPressTracker(
      {
        onTap: () => latest.current.onTap(),
        onLongPress: () => latest.current.onLongPress(),
        onHoldChange: (holding) => latest.current.onHoldChange?.(holding),
      },
      options.delay
    );
  }
  const tracker = trackerRef.current;

  useEffect(() => () => tracker.dispose(), [tracker]);

  return {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.button !== 0) return; // right button opens via onContextMenu
      tracker.down();
    },
    onPointerUp: () => tracker.up(),
    onPointerLeave: () => tracker.cancel(),
    onPointerCancel: () => tracker.cancel(),
    onClick: () => tracker.click(),
    onContextMenu: (event: React.MouseEvent) => {
      event.preventDefault();
      tracker.cancel();
      latest.current.onLongPress();
    },
  };
}
