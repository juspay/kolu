import type { Locator, SelectionRect } from "@kolu/artifact-sdk/client";
import { createSignal } from "solid-js";
import type { BrowseSurface } from "./types";

export type ComposerTarget = {
  /** Repo-relative path the new comment will be anchored to. */
  path: string;
  locator: Locator;
  lineRange?: { start: number; end: number };
  surface?: BrowseSurface;
  /** Viewport rect (parent-local coordinates) of the selection — the
   *  composer is positioned next to it. */
  rect: SelectionRect;
};

const [target, setTarget] = createSignal<ComposerTarget | null>(null);

export function useComposer() {
  return {
    /** When non-null, the composer popover should render at the rect. */
    target,
    /** Called by every capture surface (pill click, iframe bridge). A
     *  no-op when a draft is already open — drafts win. */
    open: (t: ComposerTarget): void => {
      if (target() !== null) return;
      setTarget(t);
    },
    close: (): void => {
      setTarget(null);
    },
    isComposing: () => target() !== null,
  };
}
