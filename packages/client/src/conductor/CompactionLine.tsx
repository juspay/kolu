import type { ConductorCompactionRow } from "kolu-common/conductor";
import { type Component, Show } from "solid-js";
import { compactionHeadline, compactionSentence } from "./compactionWords";
import { useConductor } from "./useConductor";
import { wakeWhen } from "./wake";

const CompactionLine: Component<{ row: ConductorCompactionRow }> = (props) => {
  const orch = useConductor();
  const sentence = () => compactionSentence(props.row, orch.state().agentName);
  const label = () => {
    const when = wakeWhen(props.row.since);
    return `${compactionHeadline(props.row)}${when === null ? "" : ` · ${when}`}`;
  };
  const tone = () =>
    props.row.state === "running"
      ? "text-busy"
      : props.row.state === "failed"
        ? "text-danger"
        : "text-fg-3";

  const SENTENCE = "mt-1.5 text-center leading-relaxed";
  const LINE =
    "flex items-center gap-2 uppercase tracking-[0.12em] list-none marker:content-none [&::-webkit-details-marker]:hidden";
  return (
    <div
      data-testid="conductor-compaction"
      data-state={props.row.state}
      class={`font-mono text-[0.62rem] ${tone()}`}
    >
      <Show
        when={props.row.state === "done"}
        fallback={
          <>
            <div data-testid="conductor-compaction-toggle" class={LINE}>
              <span class="flex-1 border-t border-edge" />
              <span>
                {props.row.state === "failed" ? "✗ " : "● "}
                {label()}
              </span>
              <span class="flex-1 border-t border-edge" />
            </div>
            <Show when={props.row.state === "failed"}>
              <p data-testid="conductor-compaction-sentence" class={SENTENCE}>
                {sentence()}
              </p>
            </Show>
          </>
        }
      >
        <details class="group min-w-0">
          <summary
            data-testid="conductor-compaction-toggle"
            class={`${LINE} cursor-pointer`}
          >
            <span class="flex-1 border-t border-edge" />
            <span>
              <span class="group-open:hidden">▸ </span>
              <span class="hidden group-open:inline">▾ </span>
              {label()}
            </span>
            <span class="flex-1 border-t border-edge" />
          </summary>
          <p data-testid="conductor-compaction-sentence" class={SENTENCE}>
            {sentence()}
          </p>
          <Show when={props.row.summary}>
            {(summary) => (
              <div
                data-testid="conductor-compaction-summary"
                class="mt-1.5 rounded-md border border-edge bg-surface-1/60 px-3 py-2 font-sans text-[0.72rem] leading-relaxed text-fg-2 whitespace-pre-wrap"
              >
                {summary()}
              </div>
            )}
          </Show>
        </details>
      </Show>
    </div>
  );
};

export default CompactionLine;
