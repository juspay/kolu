/** WHAT THE CONVERSATION IS WATCHING — the list behind the status line's
 *  `watching N`.
 *
 *  The Conductor does not sit in a wait any more: it says what it is watching
 *  and ends its turn, and kolu wakes it when one of these terminals stops,
 *  asks something, or dies. So this panel answers the question that replaces
 *  "what is it waiting for": which terminals will ring, where they are, and
 *  how they stand right now.
 *
 *  EVERY FACT HERE IS READ OFF THE FLEET, not off the conversation. The cell
 *  carries membership only (`watched`, fleet refs in add order); the name
 *  comes from the same per-host key computation the `@` menu's rows use
 *  (`fleetMentionCandidates`), and the live standing — agent, state, what it
 *  is doing, and the Look at its screen — is `ConductorLook`, the peek the
 *  transcript's agent lines already draw. Reusing that component rather than
 *  restating its status line is what keeps "how this terminal stands" from
 *  having two answers in one window.
 *
 *  A TERMINAL THAT IS NOT THERE STAYS ON THE LIST. Gone, asleep, or on a host
 *  this browser is not connected to: the row is drawn and says which, because
 *  an entry that vanished from the panel is an entry nobody can remove — and
 *  because the Conductor is still watching it (a terminal that went away is
 *  exactly what it gets woken about). The same goes for a ref this browser
 *  cannot even parse.
 *
 *  HOW LONG IT HAS BEEN IN ITS STATE is the one thing kolu cannot say
 *  exactly: a terminal record carries `lastActivityAt` — when the terminal
 *  last produced output — and no per-STATE timestamp, so what the row shows is
 *  "quiet for 4m", labelled as what it is rather than mislabelled as the state's
 *  own age. */

import { activeArm } from "@kolu/padi-client/surface";
import { type Component, createMemo, For, Show } from "solid-js";
import { decodeHostKey } from "kolu-common/hostKey";
import { agentName } from "../ui/agentDisplay";
import { hostLabel } from "../host/hostChipTone";
import {
  fleetTerminalStanding,
  useFleetTerminalIndex,
} from "../palette/fleetTerminals";
import { getClockNow } from "../time/clock";
import { formatElapsedShort } from "../time/duration";
import Tip from "../ui/Tip";
import ConductorLook from "./ConductorLook";
import { fleetMentionCandidates } from "./mentionCandidates";
import { useConductor } from "./useConductor";
import { splitWatchedRef } from "./watchedRef";

const ConductorWatchedPanel: Component<{
  /** The fleet refs the conversation watches, in add order. */
  watched: readonly string[];
}> = (props) => {
  const fleet = useFleetTerminalIndex();
  /** Ref → the name the `@` menu would offer for that terminal. The same
   *  computation, so the name a person reads here is the name they would type
   *  into the composer; a terminal the fleet index has not got is simply
   *  absent and the row falls back to its id. */
  const names = createMemo(() => {
    const byRef = new Map<string, string>();
    for (const candidate of fleetMentionCandidates(fleet())) {
      byRef.set(`${candidate.host}/${candidate.terminalId}`, candidate.name);
    }
    return byRef;
  });

  return (
    <div
      data-testid="conductor-watched-panel"
      class="min-w-0 border-t border-edge bg-surface-1 px-3 py-2"
    >
      <Show
        when={props.watched.length > 0}
        fallback={
          <p class="font-mono text-[0.65rem] text-fg-3">
            Nothing is being watched — the conversation is woken by the
            terminals it starts, and by any it is asked to watch.
          </p>
        }
      >
        <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
          <For each={props.watched}>
            {(ref) => <WatchedRow watchedRef={ref} name={names().get(ref)} />}
          </For>
        </ul>
      </Show>
      {/* RESERVED, and empty on purpose: the timed graph of these terminals'
          states goes here. It is marked rather than left implicit so the next
          person adding it does not have to re-decide where it belongs — and it
          draws nothing at all today, because a placeholder that renders is a
          feature a reader believes in. */}
      <div data-testid="conductor-watched-graph-slot" hidden />
    </div>
  );
};

/** One watched terminal. The top line is its identity and the clock; under it
 *  `ConductorLook` draws how it stands and opens its screen in place.
 *
 *  The fleet reference is `watchedRef` and NOT `ref`: `ref` is a RESERVED prop
 *  name on a Solid component. The JSX transform compiles `ref={value}` into a
 *  ref-binding callback rather than passing the value through, so `props.ref`
 *  inside the component is a function — and every read of the reference
 *  (`splitWatchedRef`, the standing, the remove) silently worked on a function
 *  instead of a string, which took the whole page down the moment the panel
 *  opened. */
function WatchedRow(props: { watchedRef: string; name: string | undefined }) {
  const orch = useConductor();
  const now = getClockNow();
  const parts = createMemo(() => splitWatchedRef(props.watchedRef));
  /** The terminal's standing on its host — read ONCE for both the agent name
   *  and the clock, so the two halves of the line can never describe two
   *  different frames. */
  const standing = createMemo(() => {
    const split = parts();
    return split === null ? null : fleetTerminalStanding(split.host, split.id);
  });
  /** WHICH agent is in it, by display name. `null` for a plain shell, a
   *  sleeping terminal or one that is gone — `ConductorLook` below says which
   *  of those it is, so this line does not repeat it. */
  const agent = createMemo(() => {
    const here = standing();
    if (here === null || here.kind !== "here") return null;
    const kind = activeArm(here.meta)?.agent?.kind;
    return kind === undefined ? null : agentName(kind);
  });
  /** When this terminal last produced output, as the fleet index reprojects
   *  it onto THIS browser's clock — so the subtraction below is between two
   *  readings of the same clock. kolu records no timestamp for the agent's
   *  STATE, so this is the honest nearest thing and the row labels it as what
   *  it is. */
  const quietFor = createMemo(() => {
    const here = standing();
    if (here === null || here.kind !== "here") return null;
    const last = here.meta.lastActivityAt;
    return last === null ? null : formatElapsedShort(Math.max(0, now() - last));
  });

  return (
    <li
      data-testid="conductor-watched-row"
      data-ref={props.watchedRef}
      class="min-w-0 rounded-md border border-edge bg-surface-0 px-2 py-1.5 text-[0.72rem]"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span
          data-testid="conductor-watched-name"
          class="min-w-0 max-w-full truncate font-semibold text-fg"
        >
          {props.name ?? parts()?.id ?? props.watchedRef}
        </span>
        <Show when={parts()}>
          {(split) => (
            <span class="shrink-0 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-accent">
              {hostLabel(decodeHostKey(split().host))}
            </span>
          )}
        </Show>
        <Show when={agent()}>
          {(which) => (
            <span
              data-testid="conductor-watched-agent"
              class="shrink-0 font-mono text-[0.6rem] text-fg-2"
            >
              {which()}
            </span>
          )}
        </Show>
        <Show when={quietFor()}>
          {(quiet) => (
            <Tip label="Time since this terminal last produced output — kolu records no timestamp for the agent's state itself">
              <span
                data-testid="conductor-watched-since"
                class="shrink-0 font-mono text-[0.6rem] text-fg-3 tabular-nums"
              >
                quiet {quiet()}
              </span>
            </Tip>
          )}
        </Show>
        <span class="flex-1" />
        <button
          type="button"
          data-testid="conductor-watched-remove"
          aria-label={`Stop watching ${props.name ?? props.watchedRef}`}
          class="shrink-0 rounded-md border border-edge-bright px-1.5 text-fg-3 hover:text-danger cursor-pointer"
          onClick={() => orch.unwatch(props.watchedRef)}
        >
          ×
        </button>
      </div>
      <Show
        when={parts()}
        fallback={
          <p
            data-testid="conductor-watched-unresolved"
            class="mt-0.5 font-mono text-[0.62rem] text-fg-3 break-all"
          >
            {props.watchedRef} — not a terminal this browser can resolve
          </p>
        }
      >
        {(split) => (
          <div class="mt-0.5 text-[0.7rem]">
            {/* The transcript's own peek, in place: the dot, the agent's state
                and what it says it is doing, and Look. Keyed by the REF, so a
                panel re-opened later finds the same row still open. */}
            <ConductorLook
              rowId={`watched:${props.watchedRef}`}
              host={split().host}
              id={split().id}
              toggleTestId="conductor-watched-look"
            />
          </div>
        )}
      </Show>
    </li>
  );
}

export default ConductorWatchedPanel;
