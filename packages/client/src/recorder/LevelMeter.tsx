import { type Component, For } from "solid-js";

const SEGMENTS = 8;

const LevelMeter: Component<{
  level: number;
  class?: string;
}> = (props) => {
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
