/** A WORK'S TERMINALS, one row each — on every work in progress, open or
 *  shut, so what each terminal is doing is read without opening anything.
 *
 *  A ROW IS SIX PARTS IN FIXED PLACES: the role as a plain word; the name,
 *  which goes to the terminal's tile while the terminal is here; what it
 *  runs, small, beside the name; the Dock's status indicator with the state
 *  in words right beside it and for how long ("Thinking for 3m"), then how
 *  far through its tasks it is and what it is doing; **Look**; and **Take
 *  over** or **Hand back** when someone drives it.
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
 *  screen to look at — and a terminal nobody drives has no lock button.
 *
 *  A terminal standing anywhere but the work's own checkout says so beside
 *  its name ("elsewhere · repo · branch", `memberPlace.ts`): it lends the
 *  work nothing, and the row is where a person sees why. */

import type { Work } from "kolu-work";
import { Key } from "@solid-primitives/keyed";
import { type Component, createMemo, Show } from "solid-js";
import { onHostWords, useKnownNames } from "./memberNames";
import { openPeek } from "./peek/usePeek";
import MemberInspector from "./MemberInspector";
import DriveButton from "./DriveButton";
import MemberPip from "./MemberPip";
import StateFor from "./StateFor";
import { liveArm, terminalStatus } from "./terminalStatus";
import { useOpenTile } from "./useOpenTile";
import { useMembership, useSeen } from "./useWorks";
import {
  isMemberInspected,
  isMemberUnfolded,
  toggleMember,
} from "./workListing";
import { type MemberLine, memberRuns } from "./workFacts";
import { memberPlace, placeWords } from "./memberPlace";
import { type Lock, ROLE_WORD } from "./workReadings";

/** "thinking" → "Thinking": the state starts the status, as a sentence. */
const sentence = (words: string): string =>
  words.charAt(0).toUpperCase() + words.slice(1);

const MemberRow: Component<{
  work: Work;
  one: MemberLine;
  names: ReadonlyMap<string, string>;
  now: number;
  /** In a work's Details the row unfolds into what is about this terminal. */
  unfolds: boolean;
}> = (props) => {
  const seen = useSeen();
  const membership = useMembership();
  const openTileAt = useOpenTile();
  const ref = () => props.one.terminal;
  /** Its own name, else its host — beside its role, so the role is not
   *  said twice. */
  const name = () => props.names.get(ref()) ?? onHostWords(ref());
  const here = () =>
    props.one.standing?.kind === "here" ? props.one.split : null;
  const runs = () => memberRuns(props.work, props.one);
  /** WHERE IT STANDS against the work's key, in words — only when it is
   *  somewhere else. */
  const elsewhere = () =>
    placeWords(
      memberPlace(
        props.work.key,
        props.one.split?.host ?? "",
        props.one.standing,
      ),
    );
  /** Its standing and the words for it, read together, or `null` for a
   *  terminal this browser cannot read. */
  const status = createMemo(() => {
    const standing = props.one.standing;
    return standing === undefined
      ? null
      : { standing, words: terminalStatus(standing) };
  });
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
  /** WHAT UNFOLDS UNDER IT, or `null` when nothing would: in a work's
   *  Details, a terminal kolu can read that is up and holding its PTY. The
   *  one fact that decides both whether the role is an unfold button and what
   *  the button opens. */
  const unfoldable = createMemo(() => {
    const at = props.one.split;
    const standing = props.one.standing;
    if (!props.unfolds || at === null || standing === undefined) return null;
    const arm = liveArm(standing);
    return arm === undefined ? null : { at, arm };
  });
  /** Open, as the picked work's Details hold it — by a press here or by
   *  Inspect on a live pane. */
  const open = () => isMemberUnfolded(ref());
  const inspected = () => isMemberInspected(ref());

  return (
    <li
      data-testid="work-member"
      data-role={props.one.member.role}
      data-ref={ref()}
      data-inspected={inspected() ? "" : undefined}
      class={`col-span-full grid min-w-0 grid-cols-subgrid items-center gap-y-0.5 overflow-hidden rounded-sm text-[0.7rem] ${
        inspected() ? "bg-surface-2 outline outline-1 outline-edge-bright" : ""
      }`}
    >
      <Show
        when={unfoldable()}
        fallback={
          <span
            data-testid="work-member-role"
            class="col-start-1 whitespace-nowrap font-semibold text-fg"
          >
            {ROLE_WORD[props.one.member.role]}
          </span>
        }
      >
        <button
          type="button"
          data-testid="work-member-role"
          aria-expanded={open()}
          aria-label={`${open() ? "Fold" : "Unfold"} ${ROLE_WORD[props.one.member.role]}`}
          class="col-start-1 flex cursor-pointer items-center gap-1 whitespace-nowrap text-start font-semibold text-fg hover:text-accent"
          onClick={() => toggleMember(ref())}
        >
          <span
            aria-hidden="true"
            class="w-2 font-mono text-[0.6rem] text-fg-3"
          >
            {open() ? "▾" : "▸"}
          </span>
          {ROLE_WORD[props.one.member.role]}
        </button>
      </Show>
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
        <Show when={elsewhere()}>
          {(words) => (
            <span
              data-testid="work-member-elsewhere"
              class="min-w-0 shrink-[999] truncate font-mono text-[0.6rem] text-warning"
            >
              {words()}
            </span>
          )}
        </Show>
      </span>
      <span
        data-testid="work-member-status"
        class="col-span-2 col-start-1 flex min-w-0 items-center gap-1.5 overflow-hidden text-fg-2 @min-[32rem]:col-span-1 @min-[32rem]:col-start-3"
      >
        <Show
          when={status()}
          fallback={
            <span class="truncate text-fg-3">a terminal kolu cannot read</span>
          }
        >
          {(now) => (
            <>
              <Show when={props.one.split}>
                {(at) => <MemberPip at={at()} standing={props.one.standing} />}
              </Show>
              {/* THE STATE AND ITS TIME hold their room; the tail after
                  them is what gives way. */}
              <span class="shrink-0 whitespace-nowrap">
                <StateFor
                  word={sentence(now().words.state)}
                  standing={now().standing}
                  reading={reading()}
                  now={props.now}
                  testId="work-member-since"
                />
              </span>
              <span class="min-w-0 truncate text-fg-3">
                <Show when={now().words.progress}>
                  {(tasks) => (
                    <>
                      {"· "}
                      <span class="tabular-nums" title={tasks().title}>
                        {tasks().text}
                      </span>{" "}
                    </>
                  )}
                </Show>
                <Show when={now().words.doing}>
                  {(doing) => <>· {doing()}</>}
                </Show>
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
            <DriveButton terminal={ref()} driver={who()} testId="work-member" />
          )}
        </Show>
      </span>
      {/* UNFOLDED: what is about this terminal, under its row. */}
      <Show when={open() ? unfoldable() : null}>
        {(what) => <MemberInspector at={what().at} arm={what().arm} />}
      </Show>
    </li>
  );
};

/** The list, or the one line that says there is nothing in it. */
const WorkTerminals: Component<{
  work: Work;
  members: ReadonlyArray<MemberLine>;
  now: number;
  /** In a work's Details each row unfolds into what is about its terminal;
   *  on a work's face it does not. */
  unfolds?: boolean;
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
          {/* KEYED BY THE TERMINAL'S REF, not by its line: a line is minted
              afresh when its record moves, and a row keyed by the line would
              be taken down and built again — its mark, its spin, the Look
              button under the pointer — for every record change. */}
          <Key each={props.members} by="terminal">
            {(one) => (
              <MemberRow
                work={props.work}
                one={one()}
                names={names()}
                now={props.now}
                unfolds={props.unfolds === true}
              />
            )}
          </Key>
        </ul>
      </section>
    </Show>
  );
};

export default WorkTerminals;
