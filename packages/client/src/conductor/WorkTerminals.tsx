/** A WORK'S TERMINALS, one row each — on every work in progress, open or
 *  shut, so what each terminal is doing is read without opening anything.
 *
 *  A ROW IS SIX PARTS IN FIXED PLACES: the role as a plain word; the name,
 *  which goes to the terminal's tile while the terminal is here; what it
 *  runs, small, beside the name; a dot with the state in words right beside
 *  it and for how long ("Thinking for 3m"), then how far through its tasks it
 *  is and what it is doing; **Look**; and **Take over** or **Hand back** when
 *  someone drives it.
 *
 *  THE LIST IS A GRID AND EACH ROW A SUBGRID of it, so the roles, the Look
 *  buttons and the lock buttons each share one left edge down the list, and
 *  no part can leave its row. In a narrow list a row is two lines (role, name
 *  and what it runs; then the status and the buttons); in a list at least
 *  32rem wide it is one. That is a container query on the list, not a window
 *  breakpoint: the same card is narrow on a phone and in a narrow column.
 *
 *  When room is short, what it runs is cut before the name, and the status's
 *  tail before its state and time.
 *
 *  A terminal with no name kolu can read shows its HOST, never an id
 *  (`memberNames.ts`). A sleeping or gone terminal has no Look — there is no
 *  screen to look at — and a terminal nobody drives has no lock button. */

import { activeArm } from "@kolu/padi-client/surface";
import { Option } from "effect";
import type { Work } from "kolu-work";
import { type Component, createMemo, For, Show } from "solid-js";
import type { FleetTerminalStanding } from "../palette/fleetTerminals";
import { elapsedSince } from "../time/duration";
import { agentName } from "../ui/agentDisplay";
import { onHostWords, useKnownNames } from "./memberNames";
import type { MemberRef } from "./memberRef";
import { openPeek } from "./peek/usePeek";
import { liveArm, STATUS_DOT, terminalStatus } from "./terminalStatus";
import { useConductor } from "./useConductor";
import { useOpenTile } from "./useOpenTile";
import { useMembership, useSeen } from "./useWorks";
import { LEVEL_WORD } from "./wake";
import {
  type Lock,
  ROLE_WORD,
  roleRuns,
  type WorkMemberRow,
} from "./workReadings";

/** One member as a card holds it: its row in the work, its ref split into the
 *  keys the fleet index is read by (`null` when this browser cannot read
 *  it), and its live standing, read once by the card. */
export interface MemberLine extends WorkMemberRow {
  readonly split: MemberRef | null;
  readonly standing: FleetTerminalStanding | undefined;
}

/** The two controls at a row's end, in the row's smaller type. */
const CONTROL =
  "cursor-pointer whitespace-nowrap rounded-sm px-1.5 py-[0.1rem] font-mono text-[0.56rem] font-semibold uppercase tracking-[0.06em] transition-colors";

/** "thinking" → "Thinking": the state starts the status, as a sentence. */
const sentence = (words: string): string =>
  words.charAt(0).toUpperCase() + words.slice(1);

const MemberRow: Component<{
  work: Work;
  one: MemberLine;
  names: ReadonlyMap<string, string>;
  now: number;
}> = (props) => {
  const seen = useSeen();
  const membership = useMembership();
  const conductor = useConductor();
  const openTileAt = useOpenTile();
  const ref = () => props.one.terminal;
  /** Its own name, else its host — beside its role, so the role is not
   *  said twice. */
  const name = () => props.names.get(ref()) ?? onHostWords(ref());
  const here = () =>
    props.one.standing?.kind === "here" ? props.one.split : null;
  /** WHAT IT RUNS: the setup's harness and model for the role, else the
   *  agent kolu sees in it, else nothing. */
  const runs = () =>
    Option.getOrElse(roleRuns(props.work, props.one.member.role), () => {
      const standing = props.one.standing;
      const kind =
        standing?.kind === "here"
          ? activeArm(standing.meta)?.agent?.kind
          : undefined;
      return kind === undefined ? "" : agentName(kind);
    });
  const status = createMemo(() =>
    props.one.standing === undefined
      ? null
      : terminalStatus(props.one.standing),
  );
  const lookable = () =>
    props.one.standing !== undefined &&
    liveArm(props.one.standing) !== undefined;
  const reading = () => seen().get(ref());
  /** WHO IS DRIVING IT, from the one membership index the tile's own frame
   *  reads — nothing for a terminal nobody drives, which has no control. */
  const driver = (): Lock | undefined => {
    const at = membership().get(ref());
    return at === undefined || at.driver === "nobody" ? undefined : at.driver;
  };

  return (
    <li
      data-testid="work-member"
      data-role={props.one.member.role}
      data-ref={ref()}
      class="col-span-full grid min-w-0 grid-cols-subgrid items-center gap-y-0.5 overflow-hidden text-[0.7rem]"
    >
      <span
        data-testid="work-member-role"
        class="col-start-1 whitespace-nowrap font-semibold text-fg"
      >
        {ROLE_WORD[props.one.member.role]}
      </span>
      <span class="col-span-3 col-start-2 flex min-w-0 items-baseline gap-2 @min-[32rem]:col-span-1">
        <Show
          when={here()}
          fallback={
            <span
              data-testid="work-member-name"
              class="min-w-[3rem] shrink truncate text-fg-3"
            >
              {name()}
            </span>
          }
        >
          {(target) => (
            <button
              type="button"
              data-testid="work-member-name"
              data-opens-tile="true"
              aria-label={`Go to ${name()}`}
              class="min-w-[3rem] shrink cursor-pointer truncate rounded-sm text-fg underline-offset-2 hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
              onClick={() => openTileAt(target())}
            >
              {name()}
            </button>
          )}
        </Show>
        <Show when={runs() !== ""}>
          <span
            data-testid="work-member-runs"
            class="min-w-0 shrink-[999] truncate font-mono text-[0.6rem] text-fg-3"
          >
            {runs()}
          </span>
        </Show>
      </span>
      <span
        data-testid="work-member-status"
        class="col-span-2 col-start-1 flex min-w-0 items-center gap-1.5 text-fg-2 @min-[32rem]:col-span-1 @min-[32rem]:col-start-3"
      >
        <Show
          when={status()}
          fallback={
            <span class="truncate text-fg-3">a terminal kolu cannot read</span>
          }
        >
          {(now) => (
            <>
              <span
                class={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[now().tone]}`}
              />
              {/* THE STATE AND ITS TIME hold their room; the tail after
                  them is what gives way. */}
              <span class="shrink-0 whitespace-nowrap">
                <span class="font-semibold text-fg">
                  {sentence(now().state)}
                </span>
                <Show when={reading()}>
                  {(read) => (
                    <span
                      data-testid="work-member-since"
                      title={`${LEVEL_WORD[read().level]} for ${elapsedSince(read().since, props.now)}`}
                      class="tabular-nums text-fg-3"
                    >
                      {" for "}
                      {elapsedSince(read().since, props.now)}
                    </span>
                  )}
                </Show>
              </span>
              <span class="min-w-0 truncate text-fg-3">
                <Show when={now().progress}>
                  {(tasks) => (
                    <>
                      {"· "}
                      <span class="tabular-nums" title={tasks().title}>
                        {tasks().text}
                      </span>{" "}
                    </>
                  )}
                </Show>
                <Show when={now().doing}>{(doing) => <>· {doing()}</>}</Show>
              </span>
            </>
          )}
        </Show>
      </span>
      {/* LOOK and the LOCK each keep their cell when they are absent, so
          the ones that are there line up down the list. */}
      <span class="col-start-3 flex @min-[32rem]:col-start-4">
        <Show when={lookable() ? props.one.split : null}>
          {(target) => (
            <button
              type="button"
              data-testid="work-member-look"
              aria-haspopup="dialog"
              aria-label={`Look at ${name()}`}
              class="cursor-pointer whitespace-nowrap rounded-md border border-edge-bright bg-surface-2 px-2 py-px text-[0.66rem] font-semibold text-accent hover:bg-surface-3"
              onClick={() => openPeek({ host: target().host, id: target().id })}
            >
              Look
            </button>
          )}
        </Show>
      </span>
      <span class="col-start-4 flex @min-[32rem]:col-start-5">
        <Show when={driver()}>
          {(who) => (
            <Show
              when={who() === "conductor"}
              fallback={
                <button
                  type="button"
                  data-testid="work-member-hand-back"
                  class={`${CONTROL} bg-alert/20 text-alert hover:bg-alert/30`}
                  onClick={() => conductor.handBack(ref())}
                >
                  Hand back
                </button>
              }
            >
              <button
                type="button"
                data-testid="work-member-take-over"
                class={`${CONTROL} bg-conductor/20 text-conductor hover:bg-conductor/30`}
                onClick={() => conductor.takeOver(ref())}
              >
                Take over
              </button>
            </Show>
          )}
        </Show>
      </span>
    </li>
  );
};

/** The list, or the one line that says there is nothing in it. */
const WorkTerminals: Component<{
  work: Work;
  members: ReadonlyArray<MemberLine>;
  now: number;
}> = (props) => {
  const names = useKnownNames();
  return (
    <Show
      when={props.members.length > 0}
      fallback={
        // AN OPEN WORK WITH NOTHING RUNNING IN IT. Losing a terminal never
        // ends a work, so this is an ordinary state and says so plainly.
        <p
          data-testid="work-no-terminals"
          class="m-0 font-mono text-[0.62rem] text-fg-3"
        >
          No terminals. Nothing is running in this work.
        </p>
      }
    >
      <section data-testid="work-terminals" class="@container min-w-0">
        <ul class="m-0 grid list-none grid-cols-[auto_minmax(0,1fr)_auto_auto] gap-x-2.5 gap-y-1.5 p-0 @min-[32rem]:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.5fr)_auto_auto] @min-[32rem]:gap-y-1">
          <For each={props.members}>
            {(one) => (
              <MemberRow
                work={props.work}
                one={one}
                names={names()}
                now={props.now}
              />
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
};

export default WorkTerminals;
