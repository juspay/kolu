import type { ForwardOrigin } from "kolu-common/surface";
import { match } from "ts-pattern";

/** The pill that carries an address — teal on a teal wash, both themes. */
export const FORWARD_PILL =
  "rounded bg-teal-500/10 px-1 font-mono text-teal-700 dark:bg-teal-400/15 dark:text-teal-300";

export const FORWARD_RING = "ring-1 ring-teal-500/70 dark:ring-teal-300/60";

export function originWord(origin: ForwardOrigin): string {
  return match(origin)
    .with("auto", () => "auto")
    .with("manual", () => "pinned")
    .exhaustive();
}

export function originTooltip(origin: ForwardOrigin): string {
  return match(origin)
    .with("auto", () => "closes itself when the server stops")
    .with("manual", () => "opened by hand — stays until you cancel it")
    .exhaustive();
}
