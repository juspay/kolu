/** The conversation's terminals, as the Dock's own row.
 *
 *  `@kolu/solid-dockrow`'s `DockRow` is the whole of what a terminal looks like
 *  in kolu, and this section renders it at the same density the dock does, off
 *  the same facts: the pip, the state words, the intent and the recency come
 *  from padi's `terminals` collection and the `urgency` cell at render time.
 *  Nothing here reads the agent's memory of a terminal — `state.fleet` is
 *  membership and nothing else, which is why a terminal somebody killed drops
 *  out instead of persisting as a row about a terminal that is gone.
 *
 *  Pressing a row PEEKS it: the active tile is what the peek pane shows, so
 *  landing on a terminal here puts it live beside the conversation. */

import { DockRow as DockRowView } from "@kolu/solid-dockrow";
import type { DockRowBucket } from "@kolu/solid-dockrow/rowValues";
import { Key } from "@solid-primitives/keyed";
import type { TerminalId } from "kolu-common/surface";
import { type Component, createMemo, Show } from "solid-js";
import { hostFrame } from "../attention/attentionMarks";
import { useAttentionFacts } from "../attention/useAttentionFacts";
import { createDockRowData } from "../canvas/dock/dockRowData";
import { rankDockRows } from "../canvas/dock/dockRowRanking";
import { useDockFocus } from "../canvas/dock/useDockFocus";
import { useDockRowBag } from "../canvas/dock/useDockRowBag";
import { useStaleCheck } from "../terminal/staleness";
import { useTerminalStore } from "../terminal/useTerminalStore";
import { nextAfter } from "../ui/nextAfter";
import { encActiveHost } from "../wire";
import { fleetView, liveFleetIds } from "./fleetRows";

const OrchestratorFleet: Component<{
  fleet: readonly TerminalId[];
}> = (props) => {
  const store = useTerminalStore();
  const isStale = useStaleCheck();
  const facts = useAttentionFacts();
  const focus = useDockFocus();

  const ranked = createMemo(() =>
    rankDockRows(
      liveFleetIds(props.fleet, (id) => store.getMetadata(id) !== undefined),
      store.getMetadata,
      isStale,
      (id) => facts.classOf(encActiveHost(), id),
      store.getPaneTree,
    ),
  );
  const view = createMemo(() => {
    // ONE read of the host's frame for both counts — the partition is computed
    // on the host and shipped whole, so taking `asking` from it and `working`
    // from somewhere else is how a header comes to disagree with the pips it
    // sits above.
    const frame = hostFrame(encActiveHost());
    return fleetView(ranked(), frame.byClass.asking, frame.byClass.working);
  });

  return (
    <Show when={view().rows.length > 0}>
      <section
        data-testid="orchestrator-fleet"
        class="px-2 py-1.5 border-b border-edge"
      >
        <div class="flex items-center px-1.5 pb-1">
          <span class="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-fg-3">
            Fleet · {view().working} working · {view().needsYou.length} asking
          </span>
          <Show when={view().needsYou.length > 0}>
            <button
              type="button"
              data-testid="orchestrator-needs-you"
              class="ml-auto text-[0.7rem] font-semibold text-alert cursor-pointer hover:underline"
              onClick={() => {
                // Walk the blocked ones: each press lands on the NEXT, so a
                // person clears a queue of questions by pressing one thing.
                const next = nextAfter(view().needsYou, store.activeId());
                if (next !== undefined) focus(next);
              }}
            >
              {view().needsYou.length} needs you ›
            </button>
          </Show>
        </div>
        {/* KEYED BY ID. `rankDockRows` mints fresh row objects on every
            metadata tick, so a reference-keyed list would dispose and rebuild
            every `FleetRow` — its `createDockRowData`, its StatePip memo, the
            whole `DockRow` — once a second. The dock itself keys by id for the
            same reason. */}
        <Key each={view().rows} by="id">
          {(row) => (
            <FleetRow
              id={row().id}
              bucket={row().bucket}
              pip={row().pip}
              recencyAt={row().ts}
              onSelect={focus}
            />
          )}
        </Key>
      </section>
    </Show>
  );
};

/** kolu's ORCHESTRATOR wiring for the shared row — the desktop density, no drag
 *  handle (a conversation's fleet is not an arrangement to rearrange) and this
 *  surface's own e2e handles. */
function FleetRow(props: {
  id: TerminalId;
  bucket: DockRowBucket;
  pip: DockRowBucket;
  recencyAt: number | null;
  onSelect: (id: TerminalId) => void;
}) {
  const combined = createDockRowData(props.id);
  const rowBag = useDockRowBag();
  return (
    <Show when={combined()}>
      {(c) => {
        // ONCE per row, not in the spread — the bag mints this row's StatePip
        // memo, and a memo re-created on every prop read either accumulates on
        // this owner or freezes the row at first paint. See `useDockRowBag`.
        const bag = rowBag({
          id: props.id,
          combined: c,
          bucket: () => props.bucket,
          pipBucket: () => props.pip,
          recencyAt: () => props.recencyAt,
        });
        return (
          <DockRowView
            {...bag}
            surface="desktop"
            onSelect={() => props.onSelect(props.id)}
            testIds={{
              row: "orchestrator-fleet-row",
              agentSubline: "orchestrator-fleet-agent-subline",
              quietSubline: "orchestrator-fleet-foreground",
            }}
          />
        );
      }}
    </Show>
  );
}

export default OrchestratorFleet;
