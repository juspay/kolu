/** ONE PIECE OF WORK, as a card.
 *
 *  SHUT, it is four lines and answers the only question a person has while
 *  something is running: what is this, who is it waiting on, and for how long.
 *  The thin bar under those lines is where the time has actually gone.
 *
 *  OPEN, it is the whole of what kolu knows, in the order a person asks for
 *  it: the questions waiting on you (the SAME form as in the chat — answering
 *  either settles the one question); what you have decided so far; the
 *  timeline of everything observed; the terminals by the part they play; the
 *  files, opened in place; the pull request; and **Stop**, which is one of the
 *  two ways a piece of work can be ended on purpose.
 *
 *  A CARD IS DRAWN FROM THE STATE SUM, and the two faces are built from
 *  different values ({@link CardFace}). An ENDED work says how it ended, what
 *  was kept and where the time went, and offers **Reopen** — and it has no
 *  terminals, no lock and no open question anywhere on it, because the ended
 *  half of the sum has nowhere to put them and this component has nothing to
 *  read them from. That is the whole of the rule: it is not enforced here, it
 *  is unspellable.
 *
 *  NOTHING HERE IS STORED TWICE. The card reads `kolu-work`'s folds over the
 *  record (`standing`, `timeBar`, `took`) and the three live facts a browser
 *  has anyway — how a member terminal stands, which agent is in it, and a PR's
 *  check runs. A number that moves every second is never written down. */

import { activeArm } from "@kolu/padi-client/surface";
import { dualPhrase } from "@kolu/terminal-vocab/duration";
import { prValue } from "anyforge/schemas";
import { decodeHostKey, isEncodedHostKey } from "kolu-common/hostKey";
import { DASH } from "kolu-common/surface";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import { Option } from "effect";
import {
  hostOf,
  lifetime,
  openAsks,
  prOf,
  took,
  type Work,
  type WorkId,
} from "kolu-work";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { hostLabel } from "../host/hostChipTone";
import {
  fleetTerminalStanding,
  useFleetTerminalIndex,
} from "../palette/fleetTerminals";
import { elapsedSince } from "../time/duration";
import { agentName } from "../ui/agentDisplay";
import InlineConfirmButton from "../ui/InlineConfirmButton";
import { useShownClock } from "../ui/shown";
import Tip from "../ui/Tip";
import ConductorLook from "./ConductorLook";
import WorkQuestion from "./WorkQuestion";
import { splitMemberRef } from "./memberRef";
import { fleetMentionCandidates } from "./mentionCandidates";
import { useConductor } from "./useConductor";
import { useOpenTile } from "./useOpenTile";
import { useMembership, useSeen, useWorkMembers } from "./useWorks";
import WorkBar from "./WorkBar";
import WorkFiles from "./WorkFiles";
import { LEVEL_WORD } from "./wake";
import { workFileSource } from "./workFile";
import {
  answerSource,
  answeredWhen,
  answerWords,
  checksBreakdown,
  checksTally,
  decisionRows,
  EVENT_INK,
  eventReader,
  type Lock,
  membersIn,
  oneLine,
  outcomeWords,
  ROLE_WORD,
  standingLine,
  timeSpentWords,
  WAITER_INK,
  workSubtitle,
} from "./workReadings";

/** The two controls on a member's row, which are the terminal's own in the
 *  card's smaller type. */
const MEMBER_CONTROL =
  "shrink-0 cursor-pointer rounded-sm px-1.5 py-[0.1rem] font-mono text-[0.56rem] font-semibold uppercase tracking-[0.06em] transition-colors";

/** What **Stop** warns about before it acts — the whole of what a person
 *  gives up, and what they do not: the record stays, and Reopen is right
 *  there on the card afterwards. */
const STOP_COPY =
  "The work is marked stopped and its terminals are released. Nothing is deleted — its decisions and its timeline stay, and you can open it again.";

/** The hour and minute an event or a decision carries, as the timeline draws
 *  it — the one clock format the card speaks. */
const clockOf = (at: string): string =>
  new Date(at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

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

/** THE TWO FACES, each built from the arm of the state sum it belongs to —
 *  {@link live} for a work in progress (its members, its open questions) and
 *  {@link ended} for one that is over (how, when, what was kept).
 *
 *  A value a face must not show is simply not in the other arm: an ended
 *  work's face has no members and no asks, so the terminals section, the lock
 *  and the question cannot be reached from it at all. */

const WorkCard: Component<{
  /** The id the work is filed under — its key, canonical. The record carries
   *  no id of its own, so every act about this work (answering it, stopping
   *  it, opening a file of it) names this. */
  id: WorkId;
  work: Work;
}> = (props) => {
  // The column's clock, stopped while nobody is looking at the pane: every
  // duration on this card ticks from it, and a hidden pane ticks for nobody.
  const now = useShownClock();
  const seen = useSeen();
  const openTileAt = useOpenTile();
  const membership = useMembership();
  const allMembers = useWorkMembers();
  const conductor = useConductor();

  /** WHICH ROWS INSIDE THIS CARD ARE OPEN — a decision's full question, or
   *  an event's words that did not fit its line. Component state, unlike the
   *  card's own: a row opened to read one question is not worth carrying
   *  across a resize, and the set dies with the card that drew it. */
  const [openRows, setOpenRows] = createSignal<ReadonlySet<string>>(new Set());
  const shown = (key: string): boolean => openRows().has(key);
  const toggleRow = (key: string): void => {
    setOpenRows((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };
  const isOpen = () => openCards().has(props.id);

  /** HOW IT ENDED, or `undefined` while it is in flight. The state's own arm,
   *  narrowed — not a copy of it. */
  const ended = createMemo(() => {
    const state = props.work.state;
    return state.kind === "ended" ? state : undefined;
  });

  /** WHAT IS RUNNING AND WHAT IS BEING ASKED, or `undefined` for a work that
   *  is over. EVERY open ask: a Conductor that asks about a failing check
   *  while a plan approval is still open has put two things to the human, and
   *  a face that draws one of them makes the second answerable nowhere. */
  const live = createMemo(() =>
    props.work.state.kind === "open"
      ? {
          members: membersIn(allMembers(), props.id),
          asks: openAsks(props.work),
        }
      : undefined,
  );

  /** The members, in the order a waterfall runs them, each with its live
   *  standing read ONCE. Three readers want that standing — the agent's name,
   *  the clock, whether there is anywhere to go — and reading it per reader is
   *  how one terminal came to be looked up three times a frame. */
  const members = createMemo(() =>
    (live()?.members ?? []).map((row) => {
      const split = splitMemberRef(row.terminal);
      const standing =
        split === null
          ? undefined
          : fleetTerminalStanding(split.host, split.id);
      return { ...row, split, standing };
    }),
  );

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
  const checks = createMemo(() => checksTally(Option.fromNullishOr(livePr())));

  /** WHERE THE FILES COME FROM — the one derivation, shared with the reader a
   *  file row opens (`workFile.ts`): the live worktree while a member reports
   *  one, kolu's kept copy otherwise. The card never asks which it got. */
  const source = createMemo(() =>
    workFileSource(props.id, props.work, members()),
  );

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
  /** The host, as a person says it — read off the work's KEY, which is where
   *  the machine a work runs on lives now: it identifies the work, so it was
   *  never a question that could go unanswered. */
  const host = createMemo(() => {
    const given = hostOf(props.work);
    if (given === "") return Option.none<string>();
    return Option.some(
      isEncodedHostKey(given) ? hostLabel(decodeHostKey(given)) : given,
    );
  });

  /** EVERY DECISION AS ONE ROW — the setup under its keys' names first, then
   *  the rest. */
  const decided = createMemo(() => decisionRows(props.work));

  /** THE TIMELINE'S WORDS, built once per move of the record rather than per
   *  row: the two facts a row needs about the WHOLE timeline (which commits
   *  its check events name, which decision an ask points at) are computed
   *  once by the reader this returns. */
  const words = createMemo(() => eventReader(props.work));

  const steps = createMemo(() =>
    took(props.work, new Date(now()).toISOString()),
  );

  return (
    <article
      data-testid="work-card"
      data-work={props.id}
      data-who={at().who}
      data-open={isOpen() ? "" : undefined}
      data-state={props.work.state.kind}
      data-outcome={
        props.work.state.kind === "ended"
          ? props.work.state.outcome.kind
          : undefined
      }
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
        onClick={() => toggleCard(props.id)}
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
          <Show when={Option.getOrUndefined(at().what)}>
            {(what) => (
              <span class="min-w-0 truncate text-fg-2">· {what()}</span>
            )}
          </Show>
          <span class="font-mono text-[0.62rem] tabular-nums text-fg-3">
            · {endedOrElapsed()}
          </span>
        </p>
        <WorkBar work={props.work} now={now()} />
      </button>

      <Show when={isOpen()}>
        {/* WHAT CHANGES MOST, FIRST. A person opens a card to answer the
            question, see who is running and what they wrote; the decisions
            and the timeline are the record behind that, and they are rows
            of one line each so the whole of an ordinary work fits a laptop
            screen without scrolling. */}
        <div class="border-t border-edge px-2.5 py-2">
          <Show when={live()}>
            {(asking) => (
              <>
                {/* THE QUESTIONS, FIRST — a person who opened this card while
                    it was violet opened it to answer something. EVERY open
                    ask, not the oldest: a Conductor that asks about a failing
                    check while a plan approval is still open has put two
                    things to the human, and a face that draws one of them
                    makes the second answerable nowhere. */}
                <For each={asking().asks}>
                  {(ask) => (
                    <div class="mb-2.5">
                      <WorkQuestion
                        work={props.work}
                        id={props.id}
                        ask={ask}
                        from="card"
                      />
                    </div>
                  )}
                </For>

                <Show
                  when={members().length > 0}
                  fallback={
                    // AN OPEN WORK WITH NOTHING RUNNING IN IT. Losing a
                    // terminal never ends a work, so this is an ordinary
                    // state and says so plainly — the Conductor is woken once
                    // with exactly this, and can join terminals back to it.
                    <p
                      data-testid="work-no-terminals"
                      class="m-0 mb-2.5 font-mono text-[0.62rem] text-fg-3"
                    >
                      No terminals — nothing is running in this work.
                    </p>
                  }
                >
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
                          const reading = () => seen().get(one.terminal);
                          /** WHO IS DRIVING THIS MEMBER, from the one
                           *  membership index the tile's own frame reads —
                           *  nothing for a terminal nothing drives
                           *  (`nobody`), which has no control here. */
                          const driver = (): Lock | undefined => {
                            const at = membership().get(one.terminal);
                            return at === undefined || at.driver === "nobody"
                              ? undefined
                              : at.driver;
                          };
                          return (
                            <li
                              data-testid="work-member"
                              data-role={one.member.role}
                              data-ref={one.terminal}
                              class="min-w-0 text-[0.7rem]"
                            >
                              <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span class="shrink-0 rounded-sm bg-conductor/15 px-1 font-mono text-[0.56rem] font-semibold uppercase tracking-[0.08em] text-conductor">
                                  {ROLE_WORD[one.member.role]}
                                </span>
                                {/* THE NAME IS THE WAY THERE — the same words
                                    the `@` menu would offer for that terminal,
                                    and the same navigation a `create` card's
                                    "open tile" takes. A member this browser
                                    cannot reach (its host is away) keeps its
                                    name and loses the press: offering a tile
                                    that may not exist is worse than offering
                                    it a moment later. */}
                                <Show
                                  when={
                                    one.standing?.kind === "here"
                                      ? one.split
                                      : null
                                  }
                                  fallback={
                                    <span
                                      data-testid="work-member-name"
                                      class="min-w-0 max-w-full truncate font-semibold text-fg-3"
                                    >
                                      {name(one.terminal)}
                                    </span>
                                  }
                                >
                                  {(target) => (
                                    <button
                                      type="button"
                                      data-testid="work-member-name"
                                      data-opens-tile="true"
                                      aria-label={`Go to ${name(one.terminal)}`}
                                      class="min-w-0 max-w-full cursor-pointer truncate rounded-sm font-semibold text-fg underline-offset-2 hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                                      onClick={() => openTileAt(target())}
                                    >
                                      {name(one.terminal)}
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
                                {/* THE KEYS, WITHOUT TYPING FIRST. The same
                                    two calls the terminal's own control makes
                                    — so a person who wants the keyboard of a
                                    driven terminal can take it from the
                                    card. */}
                                <Show when={driver()}>
                                  {(who) => (
                                    <Show
                                      when={who() === "conductor"}
                                      fallback={
                                        <button
                                          type="button"
                                          data-testid="work-member-hand-back"
                                          class={`${MEMBER_CONTROL} bg-alert/20 text-alert hover:bg-alert/30`}
                                          onClick={() =>
                                            conductor.handBack(one.terminal)
                                          }
                                        >
                                          Hand back
                                        </button>
                                      }
                                    >
                                      <button
                                        type="button"
                                        data-testid="work-member-take-over"
                                        class={`${MEMBER_CONTROL} bg-conductor/20 text-conductor hover:bg-conductor/30`}
                                        onClick={() =>
                                          conductor.takeOver(one.terminal)
                                        }
                                      >
                                        Take over
                                      </button>
                                    </Show>
                                  )}
                                </Show>
                              </div>
                              <Show when={one.split}>
                                {(split) => (
                                  <div class="mt-0.5">
                                    <ConductorLook
                                      rowId={`work:${one.terminal}`}
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
                                              {elapsedSince(
                                                read().since,
                                                now(),
                                              )}
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
              </>
            )}
          </Show>

          {/* HOW IT ENDED, on the card of a work that is over: the outcome in
              the words there are only three of. */}
          <Show when={ended()}>
            {(done) => (
              <section data-testid="work-outcome" class="mb-2.5">
                <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
                  Outcome
                </h4>
                <p class="m-0 mt-1 text-[0.7rem] text-fg">
                  {outcomeWords(done().outcome)}
                  <span class="font-mono text-[0.62rem] text-fg-3">
                    {" · "}
                    {clockOf(done().at)}
                  </span>
                </p>
              </section>
            )}
          </Show>

          <WorkFiles
            id={props.id}
            source={source()}
            kept={ended() !== undefined}
          />

          <Show when={Option.getOrUndefined(prOf(props.work))}>
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
                  <Show when={Option.getOrUndefined(checks())}>
                    {(tally) => <span> · {checksBreakdown(tally())}</span>}
                  </Show>
                </p>
              </section>
            )}
          </Show>

          {/* THE DECISIONS — the setup's answers first, under their keys'
              own names, then every other question. One line each: the full
              question, when it was answered and where from are behind the
              press, never on the card's face. They outlive the end: a work
              that was stopped and opened again still says what was decided
              about it. */}
          <Show when={decided().length > 0}>
            <section data-testid="work-decisions" class="mt-2.5">
              <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
                Decisions
              </h4>
              <ul class="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
                <For each={decided()}>
                  {(row) => (
                    <li
                      data-testid="work-decision"
                      data-key={
                        row.topic.kind === "setup" ? row.topic.key : undefined
                      }
                      data-from={Option.getOrUndefined(row.from)}
                      // The answer AS RECORDED, beside the one a person
                      // reads: the row says "On green — hand over", and what
                      // was actually answered was "hand-over".
                      data-answer={row.decisions
                        .map((one) => answerWords(one))
                        .join(" · ")}
                      class="min-w-0 text-[0.7rem]"
                    >
                      <button
                        type="button"
                        data-testid="work-decision-row"
                        aria-expanded={shown(`d:${row.id}`)}
                        class="flex w-full min-w-0 cursor-pointer items-baseline gap-1 rounded-sm text-start hover:bg-surface-1"
                        onClick={() => toggleRow(`d:${row.id}`)}
                      >
                        <span class="shrink-0 text-fg-3">{row.label}</span>
                        <span class="min-w-0 flex-1 truncate text-fg">
                          — {row.answer}
                        </span>
                      </button>
                      <Show when={shown(`d:${row.id}`)}>
                        <div
                          data-testid="work-decision-detail"
                          class="mb-1 mt-0.5 border-s border-edge ps-1.5"
                        >
                          <For each={row.decisions}>
                            {(decision) => (
                              <p class="m-0 text-[0.65rem] text-fg-2">
                                {decision.question}
                                <span class="font-mono text-[0.6rem] text-fg-3">
                                  {" · "}
                                  {answeredWhen(decision, clockOf)}
                                  <Show
                                    when={Option.getOrUndefined(
                                      answerSource(decision),
                                    )}
                                  >
                                    {(from) => <> · {from()}</>}
                                  </Show>
                                </span>
                              </p>
                            )}
                          </For>
                        </div>
                      </Show>
                    </li>
                  )}
                </For>
              </ul>
            </section>
          </Show>

          <section data-testid="work-timeline" class="mt-2.5">
            <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
              Timeline
            </h4>
            <ul class="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
              <For each={props.work.events}>
                {(event, index) => {
                  const whole = () => words()(event);
                  const cut = () => oneLine(whole());
                  const key = `e:${index()}`;
                  return (
                    <li
                      data-testid="work-event"
                      data-kind={event.kind}
                      data-by={event.by}
                      class="flex min-w-0 items-baseline gap-1.5 text-[0.7rem]"
                    >
                      <span class="w-9 shrink-0 whitespace-nowrap font-mono text-[0.6rem] tabular-nums text-fg-3">
                        {clockOf(event.at)}
                      </span>
                      <span
                        aria-hidden="true"
                        class={`h-1.5 w-1.5 shrink-0 translate-y-[-0.1em] rounded-full ${EVENT_INK[event.by]}`}
                      />
                      {/* ONE LINE, CUT — an event longer than the row says
                          the rest on a press rather than wrapping into a
                          paragraph nobody asked to read. */}
                      <Show
                        when={cut().rest}
                        fallback={
                          <span class="min-w-0 flex-1 truncate text-fg-2">
                            {cut().line}
                          </span>
                        }
                      >
                        <button
                          type="button"
                          data-testid="work-event-more"
                          aria-expanded={shown(key)}
                          class="min-w-0 flex-1 cursor-pointer rounded-sm text-start text-fg-2 hover:bg-surface-1"
                          onClick={() => toggleRow(key)}
                        >
                          <span class={shown(key) ? "" : "block truncate"}>
                            {shown(key) ? whole() : cut().line}
                          </span>
                        </button>
                      </Show>
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
                  );
                }}
              </For>
            </ul>
          </section>

          {/* WHERE THE TIME WENT, for a work that is over: the bar above says
              it in colour, this says it in figures. */}
          <Show when={ended() !== undefined}>
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

          {/* THE ONE CONTROL AT THE FOOT, and which one it is IS the state.
              Stopping is one of the only two ways a work ends on purpose (the
              Conductor's `work_stop` is the other); reopening is how an ended
              one comes back with everything it decided still on it. */}
          <div class="mt-3 border-t border-edge pt-2">
            <Show
              when={live() !== undefined}
              fallback={
                <button
                  type="button"
                  data-testid="work-reopen"
                  class="w-full cursor-pointer rounded-md border border-edge-bright px-2 py-1 text-[0.7rem] font-semibold text-fg-2 hover:text-fg"
                  onClick={() => conductor.reopenWork(props.id)}
                >
                  Reopen
                </button>
              }
            >
              <InlineConfirmButton
                label="Stop"
                inFlightLabel="Stop"
                confirmCopy={STOP_COPY}
                tone="danger"
                inFlight={false}
                testid="work-stop"
                onConfirm={() => conductor.stopWork(props.id)}
              />
            </Show>
          </div>
        </div>
      </Show>
    </article>
  );
};

export default WorkCard;
