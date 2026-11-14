/** ONE PIECE OF WORK, as a card.
 *
 *  SHUT, it is four lines and answers the only question a person has while
 *  something is running: what is this, who is it waiting on, and for how long.
 *  The thin bar under those lines is where the time has actually gone.
 *
 *  OPEN, it is the whole of what kolu knows, in the order a person asks for
 *  it: the question waiting on you (the SAME form as in the chat — answering
 *  either settles the one question); what you have decided so far; the
 *  timeline of everything observed; the terminals by the part they play; the
 *  files, opened in place; the setup; the pull request.
 *
 *  NOTHING HERE IS STORED TWICE. The card reads `kolu-work`'s folds over the
 *  record (`standing`, `timeBar`, `took`) and the three live facts a browser
 *  has anyway — how a member terminal stands, which agent is in it, and a PR's
 *  check runs. A number that moves every second is never written down. */

import { activeArm } from "@kolu/padi-client/surface";
import { dualPhrase } from "@kolu/terminal-vocab/duration";
import { prValue } from "anyforge/schemas";
import type { ConductorAskRow, ConductorRow } from "kolu-common/conductor";
import { decodeHostKey, isEncodedHostKey } from "kolu-common/hostKey";
import { DASH } from "kolu-common/surface";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import {
  lifetime,
  prOf,
  setupOf,
  took,
  type Work,
  type WorkRole,
} from "kolu-work";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { hostLabel } from "../host/hostChipTone";
import {
  fleetTerminalStanding,
  useFleetTerminalIndex,
} from "../palette/fleetTerminals";
import { elapsedSince } from "../time/duration";
import { agentName } from "../ui/agentDisplay";
import { useShownClock } from "../ui/shown";
import Tip from "../ui/Tip";
import ConductorAsk from "./ConductorAsk";
import ConductorLook from "./ConductorLook";
import { splitMemberRef } from "./memberRef";
import { fleetMentionCandidates } from "./mentionCandidates";
import { useOpenTile } from "./useOpenTile";
import { useSeen } from "./useWorks";
import WorkBar from "./WorkBar";
import WorkFiles from "./WorkFiles";
import { LEVEL_WORD } from "./wake";
import type { WorkPlace } from "./workFile";
import {
  answerSource,
  answerWords,
  checksBreakdown,
  checksTally,
  EVENT_INK,
  eventWords,
  ROLE_WORD,
  setupWords,
  standingLine,
  timeSpentWords,
  WAITER_INK,
  workSubtitle,
} from "./workReadings";

/** WHICH CARDS ARE OPEN — module state, keyed by the work's id.
 *
 *  Module rather than component state for the reason `ConductorLook`'s open
 *  set is: the column is drawn in two placements (the side column on a wide
 *  window, the band the status line opens below it) and a resize moves it
 *  between them. A card a person opened must still be open on the other side
 *  of that move; a signal inside the card would say the opposite. */
const [openCards, setOpenCards] = createSignal<ReadonlySet<string>>(new Set());

/** Open a shut card, or shut an open one. */
function toggleCard(id: string): void {
  setOpenCards((was) => {
    const next = new Set(was);
    if (!next.delete(id)) next.add(id);
    return next;
  });
}

const WorkCard: Component<{
  work: Work;
  /** The conversation's rows — where the open question about this work is
   *  drawn FROM. The card never opens a stream of its own: the pane already
   *  holds the transcript, and the form on a card is that very row. */
  rows: readonly ConductorRow[];
}> = (props) => {
  // The column's clock, stopped while nobody is looking at the pane: every
  // duration on this card ticks from it, and a hidden pane ticks for nobody.
  const now = useShownClock();
  const seen = useSeen();
  const openTileAt = useOpenTile();
  const isOpen = () => openCards().has(props.work.id);

  /** The members, in the order a waterfall runs them, each with its live
   *  standing read ONCE. Three readers want that standing — the agent's name,
   *  the clock, whether there is anywhere to go — and reading it per reader is
   *  how one terminal came to be looked up three times a frame. */
  const members = createMemo(() => {
    const order: Record<WorkRole, number> = {
      planner: 0,
      implementor: 1,
      other: 2,
    };
    return [...props.work.members]
      .sort((a, b) => order[a.role] - order[b.role])
      .map((member) => {
        const split = splitMemberRef(member.terminal);
        const standing =
          split === null
            ? undefined
            : fleetTerminalStanding(split.host, split.id);
        return { member, split, standing };
      });
  });

  /** WHAT EACH MEMBER IS CALLED — the name the `@` menu would offer for that
   *  terminal, so the words a person reads here are the words they would type
   *  into the composer. A terminal the fleet index has not got (its host is
   *  away) falls back to the short form of its id, which is still something a
   *  person can match against a tile. */
  const fleet = useFleetTerminalIndex();
  const names = createMemo(() => {
    const byRef = new Map<string, string>();
    for (const candidate of fleetMentionCandidates(fleet()))
      byRef.set(
        fleetTerminalRef(candidate.host, candidate.terminalId),
        candidate.name,
      );
    return byRef;
  });
  const name = (ref: string): string =>
    names().get(ref) ?? splitMemberRef(ref)?.id.slice(0, 8) ?? ref;

  /** THE PR, LIVE — off whichever member's record carries it. The timeline
   *  says the checks are running; how many have landed is only true for the
   *  instant it is read, so it is never stored. */
  const livePr = createMemo(() => {
    for (const one of members()) {
      const meta =
        one.standing?.kind === "here" ? one.standing.meta : undefined;
      const arm = meta === undefined ? undefined : activeArm(meta);
      const pr = arm === undefined ? null : prValue(arm.pr);
      if (pr !== null) return pr;
    }
    return null;
  });
  const checks = createMemo(() => checksTally(livePr()));

  /** WHERE THE LIVE FILES ARE: the first member whose own git reading names a
   *  worktree. `null` once the work has ended (or before any member has
   *  reported one), and then the files are the ones kolu kept. */
  const place = createMemo((): WorkPlace | null => {
    if (props.work.endedAt !== null) return null;
    for (const one of members()) {
      if (one.split === null || one.standing?.kind !== "here") continue;
      const git = one.standing.meta.git;
      if (git.kind !== "repo") continue;
      return {
        host: one.split.host,
        terminalId: one.split.id,
        repoPath: git.info.repoRoot,
      };
    }
    return null;
  });

  const at = createMemo(() => standingLine(props.work, checks()));
  /** How long the current wait has run — or, once the work has ended, how
   *  long ago it ended ("just now" inside the first second, where the
   *  elapsed readout has no figure to give). */
  const endedOrElapsed = (): string => {
    const elapsed = elapsedSince(at().since, now());
    if (at().who !== "done") return elapsed;
    return elapsed === DASH ? "just now" : `${elapsed} ago`;
  };
  /** The lead's ink: the waiter's own colour, and the quiet one for a work
   *  that is over — "done" is not a waiter, so it has no stretch of bar and
   *  no colour in that table. */
  const standingInk = (): string => {
    const who = at().who;
    return who === "done" ? "text-fg-2" : WAITER_INK[who].text;
  };
  /** The host, as a person says it. The setup decision holds whatever the
   *  human answered: an encoded host key when they picked one of kolu's
   *  (`remote:ssh://box`), and their own words when they typed instead —
   *  which is already what a person would say. */
  const host = createMemo(() => {
    const given = setupOf(props.work).host;
    if (given === null) return null;
    return isEncodedHostKey(given) ? hostLabel(decodeHostKey(given)) : given;
  });

  /** THE OPEN QUESTION, as the chat's own row. The work's decisions say WHICH
   *  ask is still open; the row is the transcript's — so the card and the chat
   *  draw one form and answering either settles it. */
  const question = createMemo((): ConductorAskRow | undefined => {
    const open = new Set(
      props.work.decisions
        .filter((one) => one.answer === null)
        .map((one) => one.ask),
    );
    if (open.size === 0) return undefined;
    for (const row of props.rows)
      if (row.kind === "ask" && open.has(row.id) && row.ask.outcome === null)
        return row;
    return undefined;
  });

  const steps = createMemo(() =>
    took(props.work, new Date(now()).toISOString()),
  );

  return (
    <article
      data-testid="work-card"
      data-work={props.work.id}
      data-who={at().who}
      data-open={isOpen() ? "" : undefined}
      data-outcome={props.work.outcome ?? undefined}
      // The needs-you edge is the one piece of colour a shut card carries: a
      // column of five works must say which one is on you without being read.
      class={`min-w-0 overflow-hidden rounded-xl border bg-surface-0 ${
        at().who === "you" ? "border-alert/55" : "border-edge"
      }`}
    >
      <button
        type="button"
        data-testid="work-card-head"
        aria-expanded={isOpen()}
        class="block w-full cursor-pointer px-2.5 py-2 text-start"
        onClick={() => toggleCard(props.work.id)}
      >
        <div class="flex min-w-0 items-baseline gap-2">
          <span class="min-w-0 flex-1 truncate text-[0.78rem] font-semibold text-fg">
            {props.work.title}
          </span>
          <Tip class="shrink-0" label="How long this piece of work has run">
            <span class="shrink-0 font-mono text-[0.62rem] tabular-nums text-fg-3">
              {dualPhrase(lifetime(props.work, new Date(now()).toISOString()))}
            </span>
          </Tip>
        </div>
        <p class="m-0 mt-0.5 truncate font-mono text-[0.62rem] text-fg-3">
          {workSubtitle(props.work, host()).join(" · ")}
        </p>
        <p
          data-testid="work-standing"
          data-who={at().who}
          class="m-0 mt-1 flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[0.7rem]"
        >
          <b class={standingInk()}>{at().lead}</b>
          <Show when={at().what !== ""}>
            <span class="min-w-0 truncate text-fg-2">· {at().what}</span>
          </Show>
          <span class="font-mono text-[0.62rem] tabular-nums text-fg-3">
            · {endedOrElapsed()}
          </span>
        </p>
        <WorkBar work={props.work} now={now()} />
      </button>

      <Show when={isOpen()}>
        <div class="border-t border-edge px-2.5 py-2">
          {/* THE QUESTION, FIRST — a person who opened this card while it was
              violet opened it to answer something. */}
          <Show when={question()}>
            {(row) => (
              <div data-testid="work-question" class="mb-2.5">
                <ConductorAsk row={row()} from="card" />
              </div>
            )}
          </Show>

          <Show when={props.work.decisions.length > 0}>
            <section data-testid="work-decisions" class="mb-2.5">
              <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
                Decisions
              </h4>
              <ul class="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
                <For each={props.work.decisions}>
                  {(decision) => (
                    <li
                      data-testid="work-decision"
                      data-key={decision.key ?? undefined}
                      data-from={decision.answer?.from ?? undefined}
                      class="text-[0.7rem] text-fg-2"
                    >
                      <span class="text-fg-3">{decision.question}</span>
                      <span class="text-fg"> — {answerWords(decision)}</span>
                      <Show when={answerSource(decision)}>
                        {(from) => (
                          <span class="font-mono text-[0.6rem] text-fg-3">
                            {" "}
                            {from()}
                          </span>
                        )}
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>

          <section data-testid="work-timeline" class="mb-2.5">
            <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
              Timeline
            </h4>
            <ul class="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
              <For each={props.work.events}>
                {(event, index) => (
                  <li
                    data-testid="work-event"
                    data-kind={event.kind}
                    data-by={event.by}
                    class="flex min-w-0 items-baseline gap-1.5 text-[0.7rem]"
                  >
                    <span class="w-9 shrink-0 whitespace-nowrap font-mono text-[0.6rem] tabular-nums text-fg-3">
                      {new Date(event.at).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        hourCycle: "h23",
                      })}
                    </span>
                    <span
                      aria-hidden="true"
                      class={`h-1.5 w-1.5 shrink-0 translate-y-[-0.1em] rounded-full ${EVENT_INK[event.by]}`}
                    />
                    <span class="min-w-0 flex-1 text-fg-2">
                      {eventWords(props.work, event)}
                    </span>
                    {/* HOW LONG THAT STEP TOOK — the step still running keeps
                        counting, with the ellipsis that says so. */}
                    <span class="shrink-0 font-mono text-[0.6rem] tabular-nums text-fg-3">
                      <Show when={steps()[index()]}>
                        {(step) =>
                          step().ms === 0 && !step().open
                            ? ""
                            : `${dualPhrase(step().ms)}${step().open ? "…" : ""}`
                        }
                      </Show>
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </section>

          <Show when={members().length > 0}>
            <section data-testid="work-terminals" class="mb-2.5">
              <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
                Terminals
              </h4>
              <ul class="m-0 mt-1 flex list-none flex-col gap-1.5 p-0">
                <For each={members()}>
                  {(one) => {
                    const meta = () =>
                      one.standing?.kind === "here"
                        ? one.standing.meta
                        : undefined;
                    const agent = () => {
                      const here = meta();
                      const kind =
                        here === undefined
                          ? undefined
                          : activeArm(here)?.agent?.kind;
                      return kind === undefined ? null : agentName(kind);
                    };
                    const reading = () => seen().get(one.member.terminal);
                    return (
                      <li
                        data-testid="work-member"
                        data-role={one.member.role}
                        data-ref={one.member.terminal}
                        data-left={one.member.leftAt === null ? undefined : ""}
                        class="min-w-0 text-[0.7rem]"
                      >
                        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span class="shrink-0 rounded-sm bg-conductor/15 px-1 font-mono text-[0.56rem] font-semibold uppercase tracking-[0.08em] text-conductor">
                            {ROLE_WORD[one.member.role]}
                          </span>
                          {/* THE NAME IS THE WAY THERE — the same words the
                              `@` menu would offer for that terminal, and the
                              same navigation a `create` card's "open tile"
                              takes. A member this browser cannot reach (its
                              host is away, or it has left the work) keeps its
                              name and loses the press: offering a tile that
                              may not exist is worse than offering it a moment
                              later. */}
                          <Show
                            when={
                              one.standing?.kind === "here" ? one.split : null
                            }
                            fallback={
                              <span
                                data-testid="work-member-name"
                                class="min-w-0 max-w-full truncate font-semibold text-fg-3"
                              >
                                {name(one.member.terminal)}
                              </span>
                            }
                          >
                            {(target) => (
                              <button
                                type="button"
                                data-testid="work-member-name"
                                data-opens-tile="true"
                                aria-label={`Go to ${name(one.member.terminal)}`}
                                class="min-w-0 max-w-full cursor-pointer truncate rounded-sm font-semibold text-fg underline-offset-2 hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                                onClick={() => openTileAt(target())}
                              >
                                {name(one.member.terminal)}
                              </button>
                            )}
                          </Show>
                          <Show when={agent()}>
                            {(which) => (
                              <span class="shrink-0 font-mono text-[0.6rem] text-fg-2">
                                {which()}
                              </span>
                            )}
                          </Show>
                        </div>
                        <Show when={one.split}>
                          {(split) => (
                            <div class="mt-0.5">
                              <ConductorLook
                                rowId={`work:${one.member.terminal}`}
                                host={split().host}
                                id={split().id}
                                toggleTestId="work-member-look"
                                clock={
                                  <Show when={reading()}>
                                    {(read) => (
                                      <span
                                        data-testid="work-member-since"
                                        class="shrink-0 font-mono text-[0.6rem] tabular-nums text-fg-3"
                                      >
                                        {LEVEL_WORD[read().level]}{" "}
                                        {elapsedSince(read().since, now())}
                                      </span>
                                    )}
                                  </Show>
                                }
                              />
                            </div>
                          )}
                        </Show>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </section>
          </Show>

          <WorkFiles work={props.work} place={place()} />

          <section data-testid="work-setup" class="mt-2.5">
            <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
              Setup
            </h4>
            <p class="m-0 mt-1 text-[0.68rem] text-fg-2">
              {setupWords(props.work, host())}
            </p>
          </section>

          <Show when={prOf(props.work)}>
            {(pr) => (
              <section data-testid="work-pr" class="mt-2.5">
                <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
                  Pull request
                </h4>
                <p class="m-0 mt-1 text-[0.68rem] text-fg-2">
                  <Show
                    when={livePr()?.url}
                    fallback={<span class="text-fg">#{pr().number}</span>}
                  >
                    {(url) => (
                      <a
                        href={url()}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="text-accent hover:underline"
                      >
                        #{pr().number}
                      </a>
                    )}
                  </Show>
                  <Show when={checks()}>
                    {(tally) => <span> · {checksBreakdown(tally())}</span>}
                  </Show>
                </p>
              </section>
            )}
          </Show>

          {/* WHERE THE TIME WENT, for a work that is over: the bar above says
              it in colour, this says it in figures. */}
          <Show when={props.work.endedAt !== null}>
            <section class="mt-2.5">
              <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
                Where the time went
              </h4>
              <p
                data-testid="work-time-spent"
                class="m-0 mt-1 text-[0.68rem] text-fg-2"
              >
                {timeSpentWords(props.work, new Date(now()).toISOString())}
              </p>
            </section>
          </Show>
        </div>
      </Show>
    </article>
  );
};

export default WorkCard;
