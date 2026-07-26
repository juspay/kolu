/** Small mono identity/status chip — the Inspector's compact vocabulary for
 *  "a fact you scan, not a sentence you read": branch, repo, PR number, CI
 *  rollup. `tone` maps to the shared semantic palette; identity chips stay
 *  neutral/accent, status chips wear ok/warning/danger. Text inside keeps the
 *  foreground tokens — the tone paints the frame, per the dataviz rule that
 *  color carries state while text stays text-colored (status tones are the
 *  exception: the value IS the state). */

import type { Component, JSX } from "solid-js";

const TONES = {
  neutral: "border-edge bg-surface-1 text-fg-2",
  accent: "border-accent/30 bg-accent/10 text-fg",
  ok: "border-ok/35 bg-ok/10 text-ok",
  warning: "border-warning/35 bg-warning/10 text-warning",
  danger: "border-danger/35 bg-danger/10 text-danger",
} as const;

const Chip: Component<{
  tone?: keyof typeof TONES;
  title?: string;
  "data-testid"?: string;
  children: JSX.Element;
}> = (props) => (
  <span
    class={`inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-md border px-1.5 py-px font-mono text-[10px] leading-relaxed ${TONES[props.tone ?? "neutral"]}`}
    title={props.title}
    data-testid={props["data-testid"]}
  >
    {props.children}
  </span>
);

export default Chip;
