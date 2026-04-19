/** Horizontal mic level meter — eight segments, lit proportionally to
 *  the 0..1 level. Used both in the setup popover and as a thin strip
 *  inside the recording pill in the chrome bar. */

import { type Component, For } from "solid-js";

const SEGMENTS = 8;

const LevelMeter: Component<{
  level: number;
  /** Tailwind sizing class — e.g. "h-2" (popover), "h-1" (recording pill). */
  class?: string;
}> = (props) => {
  // Segment i lights when level ≥ (i+1)/SEGMENTS. We bias the last two
  // segments toward amber/red so a clipping signal reads as "too loud"
  // rather than just "loud".
  return (
    <div class={`flex items-stretch gap-[2px] ${props.class ?? "h-1.5"}`}>
      <For each={Array.from({ length: SEGMENTS })}>
        {(_, i) => {
          const threshold = (i() + 1) / SEGMENTS;
          const lit = () => props.level >= threshold;
          const color = () => {
            if (i() >= SEGMENTS - 1) return "bg-danger";
            if (i() >= SEGMENTS - 3) return "bg-warning";
            return "bg-ok";
          };
          return (
            <div
              class="flex-1 rounded-[1px] transition-opacity"
              classList={{
                [color()]: lit(),
                "bg-edge opacity-40": !lit(),
                "opacity-100": lit(),
              }}
            />
          );
        }}
      </For>
    </div>
  );
};

export default LevelMeter;
