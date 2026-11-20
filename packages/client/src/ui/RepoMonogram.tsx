import type { Component } from "solid-js";
import { repoMonogram } from "./monogramGlyph";

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
