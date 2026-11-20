import type { ConductorState } from "kolu-common/conductor";
import { type Component, For, Show } from "solid-js";
import { elapsedSince } from "../time/duration";
import { useShownClock } from "../ui/shown";
import { CONDUCTOR_TEST_ID } from "./conductorTestIds";

const ConductorStrip: Component<{
  watching: ConductorState["watching"];
  onReveal: (rowId: string) => void;
}> = (props) => {
  const now = useShownClock();

  return (
    <Show when={props.watching.length > 0}>
      <div
        data-testid={CONDUCTOR_TEST_ID.strip}
        class="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-1.5 border-b border-edge font-mono text-[0.68rem] leading-4 text-fg-2"
      >
        <For each={props.watching}>
          {(out) => (
            <button
              type="button"
              data-kind={out.kind}
              data-testid={CONDUCTOR_TEST_ID.stripOut}
              class="inline-flex items-center gap-1.5 rounded-full border px-2 py-px cursor-pointer"
              classList={{
                "border-busy/45 text-busy": out.kind === "task",
                "border-edge-bright text-fg-2": out.kind === "agent",
              }}
              onClick={() => props.onReveal(out.row)}
            >
              <span>{out.kind === "task" ? "●" : "⤷"}</span>
              <span class="truncate max-w-[16rem]">{out.name}</span>
              <span class="text-fg-3">· {elapsedSince(out.since, now())}</span>
            </button>
          )}
        </For>
      </div>
    </Show>
  );
};

export default ConductorStrip;
