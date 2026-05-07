/** Canvas tile border encoding — names the policy for combining the
 *  three signals the tile carries: agent state, focus, and idle baseline.
 *
 *    Outer ring  → agent state via `pill-border-{awaiting,working}`
 *                  (single source of truth: `bucketDescriptor`).
 *    Inset glow  → active focus via `pill-glow-inner` driven by
 *                  `--card-color` (per-terminal repo accent).
 *    Edge tint   → idle baseline (`border-edge/40`) for tiles with
 *                  no bucket signal — independent of the chassis so
 *                  the tile stays legible when no agent is present.
 *
 *  The two coloured channels coexist when both are present — outer
 *  carries bucket, inset carries identity, so an active+working tile
 *  shows a steady accent ring around a brighter inset rim. Maximized
 *  drops both: edge-to-edge fill, no border at all. */

import { type AgentBucket, bucketDescriptor } from "../agent/agentPresentation";

export type TileBorderEncoding = {
  class: string;
  style: Record<string, string>;
};

/** rounded-xl is 0.75rem; the `pill-border` ::before sits at `inset: -2px`,
 *  so the outer radius must be `tile-radius + 2px` to stay flush. */
const TILE_BORDER_RADIUS = "calc(0.75rem + 2px)";

export function tileBorderEncoding(args: {
  active: boolean;
  maximized: boolean;
  bucket: AgentBucket;
  cardColor: string;
}): TileBorderEncoding {
  if (args.maximized) {
    return { class: "border border-transparent", style: {} };
  }
  const desc = bucketDescriptor(args.bucket);
  const hasBucketRing = desc.borderClass !== "";
  const classes = ["border"];
  if (hasBucketRing) {
    // pill-border ::before paints the ring; suppress the underlying
    // Tailwind border-color so the chassis doesn't fight a default 1px line.
    classes.push("border-transparent", desc.borderClass);
  } else if (args.active) {
    classes.push("border-edge-bright/70");
  } else {
    classes.push("border-edge/40", "hover:border-edge/60");
  }
  if (args.active) classes.push("pill-glow-inner");
  const style: Record<string, string> = {
    "--card-color": args.cardColor,
  };
  if (hasBucketRing) {
    style["--pill-state-color"] = desc.accentVar;
    style["--pill-border-radius"] = TILE_BORDER_RADIUS;
  }
  return { class: classes.join(" "), style };
}
