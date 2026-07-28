/** Solid monogram tile — the shared paint atom for repo (and host) identity.
 *
 *  Glyph from `repoMonogram()`; colour via `--repo-color` (set from
 *  `repoColor` / `hostHue`). Size modifiers only — the fill formula lives
 *  once in `.repo-monogram` CSS so dock / palette / restore / inspector /
 *  title never drift.
 *
 *  Not a layout wrapper: each surface composes this next to its own
 *  spine / wash / row chrome (Hickey: paint atom ≠ dock card). */

import type { Component } from "solid-js";
import { repoMonogram } from "./repoMonogram";

export type RepoMonogramSize = "md" | "sm" | "xs";

const SIZE_CLASS: Record<RepoMonogramSize, string> = {
  md: "repo-monogram--md",
  sm: "repo-monogram--sm",
  xs: "repo-monogram--xs",
};

const RepoMonogram: Component<{
  /** Identity string (repo group or host label) — feeds `repoMonogram`. */
  group: string;
  /** OKLCH / hex colour; becomes `--repo-color` on the tile. */
  color: string;
  size?: RepoMonogramSize;
  class?: string;
  "data-testid"?: string;
  /** Accessible name when the monogram stands alone; omit when decorative. */
  title?: string;
}> = (props) => (
  <span
    class={`repo-monogram ${SIZE_CLASS[props.size ?? "md"]} ${props.class ?? ""}`}
    style={{ "--repo-color": props.color }}
    aria-hidden={props.title ? undefined : "true"}
    title={props.title}
    data-testid={props["data-testid"]}
  >
    {repoMonogram(props.group)}
  </span>
);

export default RepoMonogram;
