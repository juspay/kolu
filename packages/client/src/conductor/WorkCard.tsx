/** ONE PIECE OF WORK, as a card.
 *
 *  SHUT, it is a few lines and answers the only question a person has while
 *  something is running: what is this, who is it waiting on, and for how long.
 *  The stage strip under those lines is where the time has gone, stage by
 *  stage, and which stage the work is in now.
 *
 *  OPEN, IT STAYS SHORT however long the work runs: it answers "what needs
 *  me, and where is it", and the whole history is one press further. The
 *  questions waiting on you (the SAME form as in the chat — answering either
 *  settles the one question); one row per terminal; the files; the pull
 *  request; the setup as one line and the latest three decisions; and the
 *  timeline of ONE stage — the strip is its index: pressing a cell shows that
 *  stage's events, and "whole timeline" unfolds all of it in place. Then
 *  **Stop**, one of the two ways a piece of work is ended on purpose.
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
 *  record (`standing`, `stages`, `took`) and the three live facts a browser
 *  has anyway — how a member terminal stands, which agent is in it, and a PR's
 *  check runs. A number that moves every second is never written down.
 *
 *  A WORK CHIP ELSEWHERE CAN ASK FOR THIS CARD (`./workListing.ts`'s
 *  `showWork`): it opens, and once it is on screen it scrolls itself into
 *  view and flashes once. */

import { activeArm } from "@kolu/padi-client/surface";
import { dualPhrase } from "@kolu/terminal-vocab/duration";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import { Option } from "effect";
import {
  lifetime,
  notKeptOf,
  openAsks,
  type StageName,
  type Work,
  type WorkId,
} from "kolu-work";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  type JSX,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import {
  fleetTerminalStanding,
  useFleetTerminalIndex,
} from "../palette/fleetTerminals";
import { elapsedSince } from "../time/duration";
import { agentName } from "../ui/agentDisplay";
import InlineConfirmButton from "../ui/InlineConfirmButton";
import { useShown, useShownClock } from "../ui/shown";
import Tip from "../ui/Tip";
import ConductorLook from "./ConductorLook";
import WorkCardActions from "./WorkCardActions";
import WorkQuestion from "./WorkQuestion";
import { askOnScreenKey, cardOnScreenKey, trackOnScreen } from "./onScreen";
import { splitMemberRef } from "./memberRef";
import { fleetMentionCandidates } from "./mentionCandidates";
import { useConductor } from "./useConductor";
import { useOpenTile } from "./useOpenTile";
import { useMembership, useSeen, useWorkMembers } from "./useWorks";
import PrText from "./PrText";
import StageStrip from "./StageStrip";
import WorkDecisions from "./WorkDecisions";
import WorkFiles from "./WorkFiles";
import WorkTimeline from "./WorkTimeline";
import { LEVEL_WORD } from "./wake";
import { workFileSource } from "./workFile";
import {
  cardShown,
  isCardOpen,
  openCard,
  toggleCard,
  wantedCard,
} from "./workListing";
import { checksTally, failingLine, livePrOf, prSection } from "./prReadings";
import { timelineShown } from "./timelineView";
import WorkStanding from "./WorkStanding";
import {
  clockOf,
  type Lock,
  membersIn,
  outcomeWords,
  ROLE_WORD,
  roleRuns,
  stagesOf,
  standingLine,
  timeSpentOnYou,
  timeSpentWords,
  workHost,
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

/** ONE OPEN QUESTION'S PLACE ON THE CARD — what a route onto that question
 *  scrolls to, and what tells the bell that question is in view. */
const AskSlot: Component<{
  ask: string;
  boxes: Map<string, HTMLElement>;
  children: JSX.Element;
}> = (props) => {
  let box!: HTMLDivElement;
  trackOnScreen(
    () => box,
    () => askOnScreenKey(props.ask),
    useShown(),
  );
  onMount(() => props.boxes.set(props.ask, box));
  onCleanup(() => props.boxes.delete(props.ask));
  return (
    <div ref={box} data-testid="work-ask-slot" class="mb-2.5 scroll-m-3">
      {props.children}
    </div>
  );
};

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

  const isOpen = () => isCardOpen(props.id);

  /** A ROUTE ASKED FOR THIS CARD: once it is on screen, scroll it into view
   *  and flash it once — onto the question the route named, when it named
   *  one. Asked of `shown`, as every retained view asks before touching the
   *  page — a request made while the column is hidden waits for it to come
   *  back. */
  let card!: HTMLElement;
  /** The open questions' boxes, by ask — what a route onto one scrolls to. */
  const askBoxes = new Map<string, HTMLElement>();
  const onScreen = useShown();
  // In view in a focused window, this card is what silences the bell for a
  // merge it is waiting on.
  trackOnScreen(
    () => card,
    () => cardOnScreenKey(props.id),
    onScreen,
  );
  const [flash, setFlash] = createSignal(false);
  let unflash: number | undefined;
  let frame: number | undefined;
  onCleanup(() => {
    clearTimeout(unflash);
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  createEffect(() => {
    const want = wantedCard();
    if (want === null || want.id !== props.id || !onScreen()) return;
    cardShown(want.seq);
    // A second ask while the first still flashes starts it over: the mark
    // comes off now and goes back on in the next frame.
    setFlash(false);
    clearTimeout(unflash);
    if (frame !== undefined) cancelAnimationFrame(frame);
    // After the frame that laid the card out: a card the listing has just
    // opened, or a band that has just come out, has no box until then.
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const question = want.ask === null ? undefined : askBoxes.get(want.ask);
      (question ?? card).scrollIntoView({ block: "nearest" });
      setFlash(true);
      unflash = window.setTimeout(() => setFlash(false), 1200);
    });
  });

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
    for (const candidate of fleetMentionCandidates(fleet(), membership()))
      byRef.set(
        fleetTerminalRef(candidate.host, candidate.terminalId),
        candidate.name,
      );
    return byRef;
  });
  const name = (ref: string): string =>
    names().get(ref) ?? splitMemberRef(ref)?.id.slice(0, 8) ?? ref;

  const livePr = createMemo(() => livePrOf(members()));
  const checks = createMemo(() => checksTally(Option.fromNullishOr(livePr())));
  /** All the time this work has waited on you, while it is still running. */
  const onYou = createMemo(() =>
    props.work.state.kind === "open"
      ? timeSpentOnYou(props.work, new Date(now()).toISOString())
      : 0,
  );

  /** WHERE THE FILES COME FROM — the one derivation, shared with the reader a
   *  file row opens (`workFile.ts`): the live worktree while a member reports
   *  one, kolu's kept copy otherwise. The card never asks which it got. */
  const source = createMemo(() =>
    workFileSource(props.id, props.work, members()),
  );

  const at = createMemo(() => standingLine(props.work, checks()));

  /** THE STAGES, read once for the strip and the timeline it indexes. */
  const read = createMemo(() =>
    stagesOf(props.work, new Date(now()).toISOString()),
  );
  /** WHAT THE OPEN CARD SHOWS OF ITS TIMELINE — the stage a person pressed
   *  on the strip (none: the stage the work is in) and whether the whole
   *  timeline is out. The card's own: a shut card forgets both, so the next
   *  time it opens it follows the work again. */
  const [pressed, setPressed] = createSignal<StageName | undefined>();
  const [whole, setWhole] = createSignal(false);
  /** Whether the PR's red gates are unfolded from their one line. */
  const [allFailing, setAllFailing] = createSignal(false);
  createEffect(() => {
    if (isOpen()) return;
    setPressed(undefined);
    setWhole(false);
    setAllFailing(false);
  });
  /** ... read ONCE per redraw, for the strip and the timeline both. */
  const view = createMemo(() =>
    timelineShown(props.work, read(), pressed(), whole()),
  );
  /** The cell pressed on the strip: the stage whose events the open card
   *  shows, none while it is shut or the whole timeline is out. */
  const shownStage = (): StageName | undefined => {
    const shown = view().view;
    return isOpen() && shown.kind === "stage" && shown.stage !== "setup"
      ? shown.stage
      : undefined;
  };

  return (
    <article
      ref={card}
      data-testid="work-card"
      data-work={props.id}
      data-who={at().who}
      data-open={isOpen() ? "" : undefined}
      data-flash={flash() ? "" : undefined}
      data-state={props.work.state.kind}
      data-outcome={
        props.work.state.kind === "ended"
          ? props.work.state.outcome.kind
          : undefined
      }
      // The needs-you edge is the one piece of colour a shut card carries: a
      // column of five works must say which one is on you without being read.
      // A card a chip asked for flashes once (`index.css`, `.work-card`).
      class={`work-card min-w-0 scroll-m-3 overflow-hidden rounded-xl border bg-surface-0 ${
        at().who === "you" ? "border-alert/55" : "border-edge"
      }`}
    >
      {/* THE SHUT FACE. Its press is a button laid UNDER the text rather than
          wrapped round it, so the PR number it names can be a link of its
          own: the text lets presses through to the button, and only the
          links (and the age's tooltip) take them. */}
      <div class="relative px-2.5 py-2">
        <button
          type="button"
          data-testid="work-card-head"
          aria-expanded={isOpen()}
          aria-label={props.work.title}
          class="absolute inset-0 cursor-pointer rounded-xl"
          onClick={() => toggleCard(props.id)}
        />
        <div class="pointer-events-none relative">
          <div class="flex min-w-0 items-baseline gap-2">
            <span class="min-w-0 flex-1 truncate text-[0.78rem] font-semibold text-fg">
              {props.work.title}
            </span>
            <Tip
              class="pointer-events-auto shrink-0"
              label="How long this piece of work has run"
            >
              <span class="shrink-0 font-mono text-[0.62rem] tabular-nums text-fg-3">
                {dualPhrase(
                  lifetime(props.work, new Date(now()).toISOString()),
                )}
              </span>
            </Tip>
          </div>
          <p class="m-0 mt-0.5 flex min-w-0 gap-2 font-mono text-[0.62rem] text-fg-3">
            <span class="min-w-0 flex-1 truncate">
              <PrText
                work={props.work}
                text={workSubtitle(props.work, workHost(props.work)).join(
                  " · ",
                )}
              />
            </span>
            {/* HOW LONG IT HAS WAITED ON YOU, all told — from a whole second,
                so a setup answered in a blink does not read "you 0s". */}
            <Show when={onYou() >= 1000}>
              <span data-testid="work-on-you" class="shrink-0 text-alert">
                you {dualPhrase(onYou())}
              </span>
            </Show>
          </p>
          <WorkStanding
            work={props.work}
            line={at()}
            now={now()}
            testId="work-standing"
          />
        </div>
      </div>
      {/* THE STRIP, ITS OWN ROW under the head: on a card each cell that has
          happened is a button that opens the card on that stage's events —
          the index into the timeline below. Under it, the card's ways on:
          the chat about it, its link, and its PR while that waits on you. */}
      <div class="px-2.5 pb-2">
        <StageStrip
          stages={read()}
          size="full"
          testId="stage-strip"
          index={{
            shown: shownStage,
            show: (stage) => {
              setPressed(stage);
              setWhole(false);
              openCard(props.id);
            },
          }}
        />
        <WorkCardActions id={props.id} work={props.work} />
      </div>

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
                    <AskSlot ask={ask} boxes={askBoxes}>
                      <WorkQuestion
                        work={props.work}
                        id={props.id}
                        ask={ask}
                        from="card"
                      />
                    </AskSlot>
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
                    <ul class="m-0 mt-1 flex list-none flex-col gap-1 p-0">
                      <For each={members()}>
                        {(one) => {
                          const meta = () =>
                            one.standing?.kind === "here"
                              ? one.standing.meta
                              : undefined;
                          /** WHAT IT RUNS: the setup's harness and model for
                           *  the role, else the agent kolu sees in it. */
                          const runs = () =>
                            Option.getOrElse(
                              roleRuns(props.work, one.member.role),
                              () => {
                                const here = meta();
                                const kind =
                                  here === undefined
                                    ? undefined
                                    : activeArm(here)?.agent?.kind;
                                return kind === undefined
                                  ? ""
                                  : agentName(kind);
                              },
                            );
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
                          /** The row's head: its role, its name (the way to
                           *  its tile, while this browser can reach it) and
                           *  what it runs. */
                          const lead = (
                            <>
                              <span class="shrink-0 rounded-sm bg-conductor/15 px-1 font-mono text-[0.56rem] font-semibold uppercase tracking-[0.08em] text-conductor">
                                {ROLE_WORD[one.member.role]}
                              </span>
                              <Show
                                when={
                                  one.standing?.kind === "here"
                                    ? one.split
                                    : null
                                }
                                fallback={
                                  <span
                                    data-testid="work-member-name"
                                    class="min-w-[3rem] max-w-[40%] truncate font-semibold text-fg-3"
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
                                    class="min-w-[3rem] max-w-[40%] cursor-pointer truncate rounded-sm font-semibold text-fg underline-offset-2 hover:text-accent hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
                                    onClick={() => openTileAt(target())}
                                  >
                                    {name(one.terminal)}
                                  </button>
                                )}
                              </Show>
                              <Show when={runs() !== ""}>
                                <span
                                  data-testid="work-member-runs"
                                  class="min-w-0 max-w-[30%] shrink truncate font-mono text-[0.6rem] text-fg-2"
                                >
                                  {runs()}
                                </span>
                              </Show>
                            </>
                          );
                          /** THE KEYS, WITHOUT TYPING FIRST — the same two
                           *  calls the terminal's own control makes. */
                          const trail = (
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
                          );
                          return (
                            <li
                              data-testid="work-member"
                              data-role={one.member.role}
                              data-ref={one.terminal}
                              class="min-w-0 text-[0.7rem]"
                            >
                              {/* ONE ROW: role, name, what it runs, how it
                                  stands and since when, Look, Take over —
                                  the screen Look opens goes under it. */}
                              <Show
                                when={one.split}
                                fallback={
                                  <div class="flex min-w-0 items-center gap-2">
                                    {lead}
                                    {trail}
                                  </div>
                                }
                              >
                                {(split) => (
                                  <ConductorLook
                                    rowId={`work:${one.terminal}`}
                                    host={split().host}
                                    id={split().id}
                                    toggleTestId="work-member-look"
                                    lead={lead}
                                    trail={trail}
                                    clock={
                                      /* SINCE WHEN, and only that: the state
                                         itself is the status just before it,
                                         and a second word for it is what a
                                         phone's row has no room for. */
                                      <Show when={reading()}>
                                        {(read) => (
                                          <span
                                            data-testid="work-member-since"
                                            title={`${LEVEL_WORD[read().level]} for ${elapsedSince(read().since, now())}`}
                                            class="shrink-0 font-mono text-[0.6rem] tabular-nums text-fg-3"
                                          >
                                            {elapsedSince(read().since, now())}
                                          </span>
                                        )}
                                      </Show>
                                    }
                                  />
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
                  <PrText
                    work={props.work}
                    text={outcomeWords(done().outcome)}
                  />
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
            notKept={Option.getOrUndefined(notKeptOf(props.work))}
          />

          {/* THE PULL REQUEST: its number (a link, off the record), how it
              stands, its checks — the live tally while a member's record has
              one, else the last reading the timeline kept — and, while it is
              open, whether GitHub would merge it. */}
          <Show when={Option.getOrUndefined(prSection(props.work, checks()))}>
            {(pr) => (
              <section data-testid="work-pr" class="mt-2.5">
                <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
                  Pull request
                </h4>
                <p
                  data-testid="work-pr-state"
                  data-state={pr().state}
                  class="m-0 mt-1 text-[0.68rem] text-fg"
                >
                  <PrText work={props.work} text={`#${pr().number}`} />
                  <span class="text-fg-2"> · {pr().state}</span>
                </p>
                <p
                  data-testid="work-pr-checks"
                  class="m-0 text-[0.68rem] text-fg-2"
                >
                  {pr().checks}
                </p>
                {/* THE RED GATES: one line, cut, with the count — the whole
                    list in place on a click, and back. */}
                <Show when={pr().failing.length > 0}>
                  <button
                    type="button"
                    data-testid="work-pr-failing"
                    aria-expanded={allFailing()}
                    class={`m-0 block w-full cursor-pointer text-left text-[0.68rem] text-danger hover:underline ${
                      allFailing() ? "whitespace-normal" : "truncate"
                    }`}
                    onClick={() => setAllFailing((was) => !was)}
                  >
                    {allFailing()
                      ? pr().failing.join(", ")
                      : failingLine(pr().failing)}
                  </button>
                </Show>
                <Show when={Option.getOrUndefined(pr().merge)}>
                  {(merge) => (
                    <p
                      data-testid="work-pr-merge"
                      data-merge={merge().reason}
                      class="m-0 text-[0.68rem] text-fg-2"
                    >
                      {merge().words}
                    </p>
                  )}
                </Show>
              </section>
            )}
          </Show>

          <WorkDecisions work={props.work} />

          <WorkTimeline
            id={props.id}
            work={props.work}
            shown={view()}
            onWhole={() => setWhole((was) => !was)}
            now={now()}
          />

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
