/** WHAT THE CONVERSATION IS WORKING ON — the list behind the status line's
 *  `N pieces of work · M terminals`.
 *
 *  The Conductor does not sit in a wait any more: it says what it is watching
 *  and ends its turn, and kolu wakes it when one of these terminals stops,
 *  asks something, or dies. So this panel answers the question that replaces
 *  "what is it waiting for": which terminals will ring, where they are, and
 *  how they stand right now.
 *
 *  ONE GROUP PER PIECE OF WORK. A waterfall is not a list of terminals to the
 *  person who asked for it — it is one thing, with a planner and an
 *  implementor split under it — so the rows sit under the top-level terminal
 *  their `child-of` edges end at, headed by that terminal's name. The
 *  grouping itself is NOT computed here: kolu-server walks those edges while
 *  it reads each watched terminal's record and publishes the result as
 *  `work`, which is the only place the walk can honestly happen (a host this
 *  browser never opened has no records here, and a host that is away must
 *  keep its last-known group). This panel draws it.
 *
 *  EVERY LIVE FACT HERE IS READ OFF THE FLEET, not off the conversation. The
 *  cell carries membership and the grouping only; the name — a group's head
 *  as much as a row — comes from the same per-host key computation the `@`
 *  menu's rows use (`fleetMentionCandidates`), and the live standing — agent,
 *  state, what it is doing, and the Look at its screen — is `ConductorLook`,
 *  the peek the transcript's agent lines already draw. Reusing that component
 *  rather than restating its status line is what keeps "how this terminal
 *  stands" from having two answers in one window. A root on a host this
 *  browser cannot reach has no live name, and the group then wears the name
 *  the server last read, falling back to the bare terminal id — never a blank
 *  heading.
 *
 *  A TERMINAL THAT IS NOT THERE STAYS ON THE LIST. Gone, asleep, or on a host
 *  this browser is not connected to: the row is drawn and says which, because
 *  the Conductor is still watching it (a terminal that went away is exactly
 *  what it gets woken about) and a panel that hid it would be a panel that
 *  disagrees with the list it draws. The same goes for a ref this browser
 *  cannot even parse.
 *
 *  IT IS A READING, NOT A CONTROL — with ONE exception, and it is a way OUT
 *  rather than a knob: the row's name takes you to the terminal. Nothing here
 *  takes a terminal off the list: the ways off it are telling the Conductor to
 *  stop watching one, or closing the terminal — both of which the Conductor
 *  hears about. A knob beside the row that overrode what the conversation is
 *  watching would be an override knob, and it also read as "delete this
 *  terminal", which it never was.
 *
 *  THE NAME IS THE WAY THERE, and it is the SAME way the transcript's create
 *  card goes (`useOpenTile`): switch to the terminal's host, leave the
 *  Conductor, focus the tile. Not a second navigation that agrees today. It is
 *  not offered where there is nowhere to go — a terminal that is gone, or one
 *  on a host this browser is not connected to — for the reason Look is not
 *  offered at a screen that cannot be read.
 *
 *  A GROUP OF ONE DOES NOT REPEAT ITSELF. The heading names the piece of
 *  work; when that piece is a single terminal called the same thing, the
 *  heading says the row's own name back at it, so the NAME is drawn only when
 *  the group holds more than one terminal or its name differs from its only
 *  row's. The heading's clock is drawn either way: every piece of work has an
 *  age, including one terminal's.
 *
 *  TWO LINES PER ROW: who it is (name · host · agent), then how it stands and
 *  for how long, with Look at the end. The second line is `ConductorLook`'s
 *  own — the clock is handed to it rather than drawn beside it, because the
 *  duration is a duration OF the state that line reports.
 *
 *  WHAT THE CLOCKS COUNT, exactly:
 *
 *  - A PIECE OF WORK counts from when its first terminal joined the watch
 *    list (`work[].since`, saved with the conversation, so a restart does not
 *    restart the clock). kolu records no other beginning — a waterfall is not
 *    declared anywhere — and this is the one it can vouch for.
 *  - A TERMINAL counts from when it ENTERED the state it is in, for EVERY
 *    state: `working 4m`, `asking 40s`, `asleep 2m`, `stopped 10s`. No host
 *    stamps a state change, so there was nothing here to read: the instant
 *    comes from kolu's own watch (`seen`), which is the one thing that
 *    observes every level change on every host — including the hosts no
 *    browser has a tab on, which is why it is published rather than timed
 *    here. It is runtime: a restart re-stamps at the first reading after it,
 *    which is as accurate as kolu's first sight of the state and is the only
 *    claim it can make honestly. A terminal the watch has not read yet shows
 *    no duration at all rather than `0s`.
 *
 *  THE WORD BESIDE THE DURATION IS THE WATCH'S, not Look's. They can
 *  disagree: Look reads THIS browser's live fleet index, the duration comes
 *  from the server's last reading of that terminal's host, and Look's
 *  vocabulary is its own ("thinking", "starting claude", "its host is not
 *  connected"). Pairing one source's word with the other's clock would draw
 *  "thinking · 4m" where the four minutes are four minutes of something else.
 *  So the row writes the watch's level with the watch's clock — `working 4m`
 *  — beside the line Look writes, and each half is true about itself. */

import { activeArm } from "@kolu/padi-client/surface";
import type { ConductorState } from "kolu-common/conductor";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import { type Component, createMemo, For, Show } from "solid-js";
import { decodeHostKey } from "kolu-common/hostKey";
import { agentName } from "../ui/agentDisplay";
import { hostLabel } from "../host/hostChipTone";
import {
  fleetTerminalStanding,
  useFleetTerminalIndex,
} from "../palette/fleetTerminals";
import { elapsedSince } from "../time/duration";
import Tip from "../ui/Tip";
import ConductorLook from "./ConductorLook";
import { useShownClock } from "../ui/shown";
import { fleetMentionCandidates } from "./mentionCandidates";
import { LEVEL_WORD } from "./wake";
import { splitWatchedRef } from "./watchedRef";
import { useOpenTile } from "./useOpenTile";

const ConductorWatchedPanel: Component<{
  /** The pieces of work, as kolu-server publishes them: one entry per
   *  top-level terminal, carrying the watched refs under it in watch order,
   *  and the groups themselves in the order their first member was added. */
  work: ConductorState["work"];
  /** HOW EACH WATCHED TERMINAL STANDS and since when, as kolu's watch read it
   *  — one entry per ref it has actually read, so a ref that is absent is one
   *  nothing has looked at yet rather than one standing at `0s`. */
  seen: ConductorState["seen"];
  /** WHERE THIS COPY IS DRAWN, and nothing more — the rows, the names, the
   *  clocks and the Look are identical in both. `inline` is the band the
   *  status line's control opens above itself below the two-column
   *  breakpoint, so it is separated from the line by its own top edge;
   *  `side` is the always-on column beside the conversation on a wide window
   *  (`ConductorPane`), which already has the frame's own left edge. */
  placement: "inline" | "side";
}> = (props) => {
  const fleet = useFleetTerminalIndex();
  /** The pane's clock, stopped while nobody is looking at it — the ONE tick
   *  behind every duration drawn here, the groups' ages and the rows' alike.
   *  Read in the panel so one subscription serves the headings; each row
   *  reads it again for its own, and a tick therefore invalidates the
   *  duration texts and nothing else. */
  const now = useShownClock();
  /** Ref → the name the `@` menu would offer for that terminal. The same
   *  computation, so the name a person reads here is the name they would type
   *  into the composer; a terminal the fleet index has not got is simply
   *  absent and the row — or the group's head — falls back to what the server
   *  last read, and then to its id. */
  const names = createMemo(() => {
    const byRef = new Map<string, string>();
    for (const candidate of fleetMentionCandidates(fleet())) {
      byRef.set(
        fleetTerminalRef(candidate.host, candidate.terminalId),
        candidate.name,
      );
    }
    return byRef;
  });
  /** Ref → the watch's last reading of it, for the rows' clocks. A map rather
   *  than a scan per row: the whole list is republished on every publish, and
   *  a row searching it would be the panel's one quadratic read. */
  const readings = createMemo(() => {
    const byRef = new Map<string, ConductorState["seen"][number]>();
    for (const one of props.seen) byRef.set(one.ref, one);
    return byRef;
  });

  return (
    <div
      data-testid="conductor-watched-panel"
      data-placement={props.placement}
      // ONE `class` BINDING, derived from the placement: a `classList` beside
      // a static `class` loses here (Solid applies the static one last and
      // erases the state class), which is the defect `HostChipShell` is the
      // worked example of.
      class={`min-w-0 px-3 py-2 ${props.placement === "inline" ? "border-t border-edge bg-surface-1" : "bg-surface-0"}`}
    >
      <Show
        when={props.work.length > 0}
        fallback={
          /* ONE QUIET LINE. The side column is on screen whether or not
             anything is being watched — that is what keeps the conversation
             from sliding sideways when the first terminal appears — so what
             it says with nothing in it has to be a sentence and not a hole.
             It never reads `0`. */
          <p
            data-testid="conductor-watched-empty"
            class="m-0 font-mono text-[0.65rem] text-fg-3"
          >
            Nothing in progress.
          </p>
        }
      >
        <ul class="m-0 flex list-none flex-col gap-2 p-0">
          <For each={props.work}>
            {(piece) => (
              <li
                data-testid="conductor-watched-group"
                data-root={piece.root}
                class="min-w-0"
              >
                {/* THE HEAD IS THE WORK'S NAME AND ITS AGE. The root terminal
                    may not be watched itself (a split is watched while the
                    planner above it is not) — so it is named, not drawn as a
                    row. The NAME is drawn only when it says something the
                    rows beneath it do not: one terminal under a heading of
                    its own name is the same word twice. The age is drawn
                    always, because a piece of work of one terminal has been
                    going just as long as one of four. */}
                {/* A `div` and not a `p`: the clock's tooltip wraps its
                    trigger in a block element, which a paragraph cannot hold
                    — the browser would close the paragraph early and the
                    heading would come apart. */}
                <div class="mb-1 flex min-w-0 items-baseline gap-2">
                  <Show when={groupHeading(piece, names())}>
                    {(head) => (
                      <span
                        data-testid="conductor-watched-group-name"
                        class="min-w-0 truncate font-mono text-[0.62rem] uppercase tracking-[0.08em] text-fg-3"
                      >
                        {head()}
                      </span>
                    )}
                  </Show>
                  <Tip
                    class="shrink-0"
                    label="How long this piece of work has been going — counted from when its first terminal joined the watch list"
                  >
                    <span
                      data-testid="conductor-watched-group-since"
                      class="shrink-0 font-mono text-[0.62rem] tabular-nums text-fg-3"
                    >
                      {elapsedSince(piece.since, now())}
                    </span>
                  </Tip>
                </div>
                <ul class="m-0 flex list-none flex-col gap-1.5 p-0">
                  <For each={piece.refs}>
                    {(ref) => (
                      <WatchedRow
                        watchedRef={ref}
                        name={names().get(ref)}
                        seen={readings().get(ref)}
                      />
                    )}
                  </For>
                </ul>
              </li>
            )}
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

/** What a watched ref is CALLED on screen: the name the `@` menu would offer
 *  for it, then the bare terminal id, then the raw ref. ONE computation, so
 *  the group-of-one rule below compares the words a person actually reads
 *  rather than a second rendering of them. */
function refLabel(ref: string, fleetName: string | undefined): string {
  return fleetName ?? splitWatchedRef(ref)?.id ?? ref;
}

/** The heading a piece of work is drawn under, or `null` when it would only
 *  repeat its single row. The name is the fleet's, then the one the server
 *  last read, then the root's bare id — a heading is never blank. */
function groupHeading(
  piece: ConductorState["work"][number],
  names: ReadonlyMap<string, string>,
): string | null {
  const head =
    names.get(piece.root) ??
    (piece.name === ""
      ? (splitWatchedRef(piece.root)?.id ?? piece.root)
      : piece.name);
  const only = piece.refs.length === 1 ? piece.refs[0] : undefined;
  return only !== undefined && refLabel(only, names.get(only)) === head
    ? null
    : head;
}

/** One watched terminal, in two lines: who it is, then how it stands and for
 *  how long. The second line is `ConductorLook`'s — the transcript's own peek
 *  — with this row's clock handed to it.
 *
 *  The fleet reference is `watchedRef` and NOT `ref`: `ref` is a RESERVED prop
 *  name on a Solid component. The JSX transform compiles `ref={value}` into a
 *  ref-binding callback rather than passing the value through, so `props.ref`
 *  inside the component is a function — and every read of the reference
 *  (`splitWatchedRef`, the standing, the clock) silently worked on a function
 *  instead of a string, which took the whole page down the moment the panel
 *  opened. */
function WatchedRow(props: {
  watchedRef: string;
  name: string | undefined;
  /** The watch's last reading of this terminal, or `undefined` for one it has
   *  not read — which is what the row's clock is drawn from. */
  seen: ConductorState["seen"][number] | undefined;
}) {
  // Gated on the pane being the shown view: a clock ticking behind a host tab
  // would wake this row once a second for nobody.
  const now = useShownClock();
  const openTileAt = useOpenTile();
  const parts = createMemo(() => splitWatchedRef(props.watchedRef));
  /** The terminal's standing on its host — read ONCE for the agent name, the
   *  clock and whether there is anywhere to go, so the parts of the row can
   *  never describe two different frames. */
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
  /** WHERE THE NAME GOES, or `null` when there is nowhere. A terminal is
   *  reachable when this browser's fleet index has it — which is exactly "its
   *  host is connected and the terminal is still in its roster". `gone` and
   *  `unreachable` are the two the human named; `loading` is the frame before
   *  the host has answered, and offering a tile that may not exist is worse
   *  than offering it a moment later. A SLEEPING terminal stays reachable: its
   *  tile is on the canvas, which is the thing this goes to — that is where
   *  this rule parts company with Look's, which needs a live screen to read. */
  const goTo = createMemo(() => {
    const split = parts();
    return split !== null && standing()?.kind === "here" ? split : null;
  });
  /** HOW LONG IT HAS STOOD AS IT STANDS, in the word the whole app calls that
   *  level — `working 4m`, `asking 40s`, `asleep 2m`, `stopped 10s`. ONE rule
   *  for every state, because the instant comes from the only thing that sees
   *  a state CHANGE: kolu's watch, which stamped it when it first read the new
   *  level.
   *
   *  The word is `wake.ts`'s {@link LEVEL_WORD} and not the wire token: the
   *  levels are a PROTOCOL enum, revved by the rules, and printing one raw
   *  makes every wording change a wire change (and reads as jargon in the
   *  meantime — `shell`, to a person, is `no agent`). The wake line says the
   *  same words for the same levels, from the same table.
   *
   *  `null` for a terminal the watch has not read in this process — nothing
   *  has looked at its host, or its host is away — because a row showing no
   *  duration is the honest answer where `0s` is not.
   *
   *  The level is the WATCH'S and not the state `ConductorLook` prints beside
   *  it: the two come from different readings on different clocks (see the
   *  header), and lending one source's clock to the other's word is how a row
   *  comes to say something neither of them said. */
  const clock = createMemo((): { text: string; measures: string } | null => {
    const reading = props.seen;
    if (reading === undefined) return null;
    const word = LEVEL_WORD[reading.level];
    return {
      text: `${word} ${elapsedSince(reading.since, now())}`,
      measures: `How long kolu's watch has read this terminal as ${word} — counted from the reading that first saw it`,
    };
  });

  return (
    <li
      data-testid="conductor-watched-row"
      data-ref={props.watchedRef}
      class="min-w-0 rounded-md border border-edge bg-surface-0 px-2 py-1.5 text-[0.72rem]"
    >
      {/* LINE ONE: WHO IT IS. */}
      <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <Show
          when={goTo()}
          fallback={
            <span
              data-testid="conductor-watched-name"
              class="min-w-0 max-w-full truncate font-semibold text-fg"
            >
              {refLabel(props.watchedRef, props.name)}
            </span>
          }
        >
          {(target) => (
            <button
              type="button"
              data-testid="conductor-watched-name"
              // What the row offers, for a test and for a reader of the DOM:
              // the same name without this attribute is a terminal there is
              // nowhere to go to.
              data-opens-tile="true"
              // The accessible name says what pressing it DOES and still
              // carries the visible words, so a voice command spoken as they
              // are read lands on it.
              aria-label={`Go to ${refLabel(props.watchedRef, props.name)}`}
              class="min-w-0 max-w-full cursor-pointer truncate rounded-sm font-semibold text-fg underline-offset-2 hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              onClick={() => openTileAt(target())}
            >
              {refLabel(props.watchedRef, props.name)}
            </button>
          )}
        </Show>
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
      </div>
      {/* LINE TWO: HOW IT STANDS, for how long, and the Look. */}
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
                and what it says it is doing, this row's clock, and Look. Keyed
                by the REF, so a panel re-opened later finds the same row still
                open. */}
            <ConductorLook
              rowId={`watched:${props.watchedRef}`}
              host={split().host}
              id={split().id}
              toggleTestId="conductor-watched-look"
              clock={
                <Show when={clock()}>
                  {(reading) => (
                    <Tip class="shrink-0" label={reading().measures}>
                      <span
                        data-testid="conductor-watched-since"
                        class="shrink-0 font-mono text-[0.6rem] tabular-nums text-fg-3"
                      >
                        {reading().text}
                      </span>
                    </Tip>
                  )}
                </Show>
              }
            />
          </div>
        )}
      </Show>
    </li>
  );
}

export default ConductorWatchedPanel;
