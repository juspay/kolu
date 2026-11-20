/** A COMPACTION, as one line in the chat — drawn like the `— new session —`
 *  divider: a rule, the words, a rule.
 *
 *  Running, it is in the working colour. Done, it opens to the agent's own
 *  summary under a sentence saying what happened to the rules. Failed, it is
 *  in the danger colour with the agent's reason under it, and the
 *  conversation carries on as it was. A plain `<details>`, owned by the DOM
 *  like the wake row, so an open line stays open while the row refines. */

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

  return (
    <div
      data-testid="conductor-compaction"
      data-state={props.row.state}
      class={`font-mono text-[0.62rem] ${tone()}`}
    >
      <details class="group min-w-0" open={props.row.state === "failed"}>
        <summary
          data-testid="conductor-compaction-toggle"
          class="flex items-center gap-2 uppercase tracking-[0.12em] list-none marker:content-none [&::-webkit-details-marker]:hidden"
          classList={{ "cursor-pointer": props.row.state === "done" }}
          onClick={(event) => {
            if (props.row.state !== "done") event.preventDefault();
          }}
        >
          <span class="flex-1 border-t border-edge" />
          <span>
            <Show when={props.row.state === "done"}>
              <span class="group-open:hidden">▸ </span>
              <span class="hidden group-open:inline">▾ </span>
            </Show>
            <Show when={props.row.state === "running"}>● </Show>
            <Show when={props.row.state === "failed"}>✗ </Show>
            {label()}
          </span>
          <span class="flex-1 border-t border-edge" />
        </summary>
        <Show when={props.row.state !== "running"}>
          <p
            data-testid="conductor-compaction-sentence"
            class="mt-1.5 text-center leading-relaxed"
          >
            {sentence()}
          </p>
        </Show>
        <Show when={props.row.state === "done" && props.row.summary}>
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
    </div>
  );
};

export default CompactionLine;
