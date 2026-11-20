import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";
import type { CanvasTileMode } from "./CanvasTile";

export const SEEN_DETACH_GRACE_MS = 60 * 60_000;

export interface TileSeenFacts {
  readonly viewShown: boolean;
  readonly cameraSettled: boolean;
  readonly mode: CanvasTileMode;
  readonly active: boolean;
  /** Does the tile's rect overlap the canvas view (plus the aura's margin)?
   *  False for a tile with no resolved layout yet — see `CanvasTile`. */
  readonly onScreen: boolean;
}

export function tileIsSeen(facts: TileSeenFacts): boolean {
  if (!facts.viewShown) return false;
  if (facts.mode === "maximized") return true;
  if (facts.mode === "covered") return false;
  return facts.active || (facts.onScreen && facts.cameraSettled);
}

export function createHeldSeen(seen: Accessor<boolean>): Accessor<boolean> {
  const [held, setHeld] = createSignal(seen());
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cancel = () => {
    if (timer === undefined) return;
    clearTimeout(timer);
    timer = undefined;
  };
  createEffect(
    on(seen, (now) => {
      if (now) {
        cancel();
        setHeld(true);
        return;
      }
      if (!held()) return;
      timer = setTimeout(() => {
        timer = undefined;
        setHeld(false);
      }, SEEN_DETACH_GRACE_MS);
    }),
  );
  onCleanup(cancel);
  return held;
}
