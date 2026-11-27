/** ONE PIECE OF WORK — a card or a row on the board, or the picked work.
 *
 *  ON THE BOARD it is a few lines and answers the only question a person has
 *  while something is running: what is this, who is it waiting on, and for
 *  how long. A work that needs you, and a finished one, is a CARD; every
 *  other work in progress is a ROW of its group's table. The stage map is
 *  where the work has been, which loops it has gone round and how often,
 *  and which stage it is in now. A question waiting on you is on the face,
 *  as the SAME form as in the chat (answering either settles the one
 *  question), so a work that needs you is answered without picking it. It
 *  is drawn once, on the face.
 *
 *  PICKED, it is the work the screen is about, with a switch between three
 *  views. **Terminals** is a live pane per terminal (`WorkLive.tsx`), in
 *  front while one is up. **Code** is the Code view of the work's worktree
 *  (`WorkCode.tsx`), in front only when a person chose it. **Details** is
 *  the record behind the face, short
 *  however long the work runs: one row per terminal; the files; the pull
 *  request; the setup as one line and the latest three decisions; and the
 *  timeline of ONE stage — the map is its index: pressing a stage shows
 *  that stage's events — with the TRAIL of every visit above it, whose
 *  segments index it by visit; "whole timeline" unfolds all of it in place.
 *  Then **Stop**, one of the two ways a piece of work is ended on purpose.
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
 *  A WORK CHIP ELSEWHERE CAN ASK FOR THIS WORK (`./workListing.ts`'s
 *  `showWork`): it is picked, and once it is on screen it scrolls itself into
 *  view and flashes once. */

import { dualPhrase } from "@kolu/terminal-vocab/duration";
import { DASH } from "kolu-common/surface";
import {
  type Doubt,
  lifetime,
  openAsks,
  type StageName,
  type Work,
  type WorkId,
} from "kolu-work";
import type { JSX } from "@solidjs/web";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  onSettled,
  Show,
  Switch,
  untrack,
} from "solid-js";
import { elapsedSince } from "../time/duration";
import WorkSubtitle from "./WorkSubtitle";
import { useShown, useShownClock } from "../ui/shown";
import Tip from "../ui/Tip";
import WorkCardActions from "./WorkCardActions";
import WorkQuestion from "./WorkQuestion";
import StageMap from "./StageMap";
import WorkDetails from "./WorkDetails";
import WorkLive from "./WorkLive";
import { PICKED_VIEWS, type PickedView, pickedView } from "./livePanes";
import { liveArm } from "./terminalStatus";
import { workFileSource } from "./workFile";
import {
  cardShown,
  cardWaiting,
  chooseView,
  chosenView,
  isPicked,
  pickWork,
  stageAskedFor,
  togglePick,
  wantedCard,
} from "./workListing";
import { createWorkFacts } from "./workFacts";
import { type TimelinePick, timelineShown } from "./timelineView";
import WorkStanding from "./WorkStanding";
import {
  outcomeWords,
  repoName,
  sameStages,
  stagesOf,
  timeSpentOnYou,
} from "./workReadings";
import WorkTerminals from "./WorkTerminals";
import WorkHeld from "./WorkHeld";
import WorkWorktree from "./WorkWorktree";
import WorkCode from "./WorkCode";

/** What each of the picked work's views is called on its switch. */
const VIEW_WORD: Record<PickedView, string> = {
  terminals: "Terminals",
  code: "Code",
  details: "Details",
};

/** ONE OPEN QUESTION'S PLACE ON THE CARD — what a route onto that question
 *  scrolls to. Whether the question is in view is the question's own to say
 *  (`WorkQuestion`), wherever it is drawn. */
const AskSlot: Component<{
  ask: string;
  boxes: Map<string, HTMLElement>;
  children: JSX.Element;
}> = (props) => {
  let box!: HTMLDivElement;
  onSettled(() => {
    props.boxes.set(props.ask, box);
    return () => props.boxes.delete(props.ask);
  });
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
  /** HOW IT IS DRAWN. A `card` is a block of its own — a work that needs
   *  you, with its question. A `row` is one line of a group's table, for
   *  every other work in progress: title, stage line, terminals and age side
   *  by side. A `line` is a finished work in the Finished list: title,
   *  repository, how it ended, how long it ran and when. `picked` is the
   *  work the screen is about, with its Terminals and Details. A press on a
   *  card, a row or a line picks it; a press on the picked one unpicks it. */
  shape: "card" | "row" | "line" | "picked";
}> = (props) => {
  // The column's clock, stopped while nobody is looking at the pane: every
  // duration on this card ticks from it, and a hidden pane ticks for nobody.
  const now = useShownClock();
  /** Its record as one read, its members, its own PR and checks, and where
   *  it stands — the one reading the work's line in the sidebar and its
   *  chip read too. Every fold below reads `record()`: a fold is a total
   *  function of the record, and reading the store leaf by leaf subscribes
   *  one node per leaf where this subscribes one per record. */
  const { record, members, pr, checks, at } = createWorkFacts(
    () => props.id,
    () => props.work,
  );

  const isOpen = () => isPicked(props.id);

  /** A ROUTE ASKED FOR THIS CARD: once it is on screen, scroll it into view
   *  and flash it once — onto the question the route named, when it named
   *  one. Asked of `shown`, as every retained view asks before touching the
   *  page — a request made while the column is hidden waits for it to come
   *  back. */
  let card!: HTMLElement;
  /** The open questions' boxes, by ask — what a route onto one scrolls to. */
  const askBoxes = new Map<string, HTMLElement>();
  const onScreen = useShown();
  const [flash, setFlash] = createSignal(false);
  let unflash: number | undefined;
  let frame: number | undefined;
  onCleanup(() => {
    clearTimeout(unflash);
    if (frame !== undefined) cancelAnimationFrame(frame);
  });
  createEffect(
    () => ({ want: wantedCard(), id: props.id, onScreen: onScreen() }),
    ({ want, id, onScreen: visible }) => {
      if (want === null || want.id !== id || !visible) return;
      // ANSWERED ALREADY: the request stands after it is served (it names the
      // work that is still picked), so what tells a new ask from a standing
      // one is the cards' own cursor, not the request going away.
      if (!cardWaiting(want.seq)) return;
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
    },
    // An effect takes no name from the compiler, and its findings are
    // reported at its OWNER's JSX site (`WorkColumn.tsx:150`), so this one
    // says which effect it is itself.
    { name: "wantedCard" },
  );

  /** WHAT IS BEING ASKED, or `undefined` for a work that is over. EVERY open
   *  ask: a Conductor that asks about a failing check while a plan approval
   *  is still open has put two things to the human, and a face that draws
   *  one of them makes the second answerable nowhere. */
  const live = createMemo(() => {
    const work = record();
    return work.state.kind === "open" ? { asks: openAsks(work) } : undefined;
  });
  /** All the time this work has waited on you, while it is still running. */
  const onYou = createMemo(() => {
    const work = record();
    return work.state.kind === "open"
      ? timeSpentOnYou(work, new Date(now()).toISOString())
      : 0;
  });

  /** WHERE THE FILES COME FROM — the one derivation, shared with the reader a
   *  file row opens (`workFile.ts`): the live worktree while a member reports
   *  one, kolu's kept copy otherwise. The card never asks which it got. */
  const source = createMemo(() =>
    workFileSource(props.id, record(), members()),
  );

  /** THE STAGES, read once for the map, the trail and the timeline they
   *  index — and gated on what they say: the fold walks the whole timeline
   *  again on every tick of the clock, so a card whose stages have not moved
   *  would redraw its map, its trail and every timeline row each second. */
  const read = createMemo(
    () => stagesOf(record(), new Date(now()).toISOString()),
    { equals: sameStages },
  );
  /** WHAT THE PICKED WORK SHOWS OF ITS TIMELINE — the stage pressed on the
   *  map or the visit pressed on the trail (none: the stage the work is in)
   *  and whether the whole timeline is out. The face's own, seeded from the
   *  press that picked it: a work unpicked forgets both, so the next time it
   *  is picked it follows the work again. */
  const [pressed, setPressed] = createSignal<TimelinePick | undefined>(
    // READ ONCE, deliberately: the seed is the press that picked this work,
    // and a later press writes this signal rather than re-seeding it.
    untrack(() => {
      const asked = stageAskedFor();
      return isOpen() && asked !== undefined
        ? { kind: "stage", stage: asked }
        : undefined;
    }),
  );
  const [whole, setWhole] = createSignal(false);
  createEffect(
    () => isOpen(),
    (open) => {
      if (open) return;
      setPressed(undefined);
      setWhole(false);
    },
  );
  /** ... read ONCE per redraw, for the map, the trail and the timeline. */
  const view = createMemo(() =>
    timelineShown(record(), read(), pressed(), whole()),
  );
  /** The stage, or doubt, pressed on the map: the place whose events the
   *  picked work shows, none while it is not picked, a visit is shown or the
   *  whole timeline is out. */
  const shownStage = (): StageName | Doubt | undefined => {
    const shown = view().view;
    return isOpen() && shown.kind === "stage" && shown.stage !== "setup"
      ? shown.stage
      : undefined;
  };
  /** ... and the visit pressed on the trail. */
  const shownVisit = (): number | undefined => {
    const shown = view().view;
    return shown.kind === "visit" ? shown.visit : undefined;
  };

  const row = () => props.shape === "row";
  /** A row or a line: one line of its group's list, which draws the edges. */
  const flat = () => props.shape === "row" || props.shape === "line";
  /** The repository a branch work is in; a watch has none. */
  const repo = (): string | undefined =>
    props.work.key.kind === "branch"
      ? repoName(props.work.key.repo)
      : undefined;
  /** How a finished work ended; nothing for one still in progress. */
  const endedHow = (): string | undefined =>
    props.work.state.kind === "ended"
      ? outcomeWords(props.work.state.outcome)
      : undefined;
  /** When it ended, as an age: "2d ago". */
  const endedAgo = (): string => {
    const elapsed = elapsedSince(at().since, now());
    return elapsed === DASH ? "just now" : `${elapsed} ago`;
  };

  /** A terminal of the work is up: there is a screen to watch. */
  const anyUp = () =>
    members().some(
      (one) =>
        one.standing !== undefined && liveArm(one.standing) !== undefined,
    );
  /** THE PICKED WORK'S VIEW IN FRONT. A work that is over has no terminals,
   *  so its details are all it has. */
  const shownView = (): PickedView =>
    live() === undefined ? "details" : pickedView(chosenView(), anyUp());

  /** THE SWITCH between the picked work's three views, in its head. */
  const views = () => (
    <div
      data-testid="work-views"
      class="mt-2 inline-flex rounded-md border border-edge bg-surface-1 p-0.5"
    >
      <For each={PICKED_VIEWS}>
        {(one) => (
          <button
            type="button"
            data-testid="work-view"
            data-view={one}
            aria-pressed={shownView() === one ? "true" : "false"}
            class={`cursor-pointer rounded px-2.5 py-0.5 text-[0.72rem] ${
              shownView() === one
                ? "bg-surface-0 font-semibold text-fg shadow-sm"
                : "text-fg-2 hover:text-fg"
            }`}
            onClick={() => chooseView(one)}
          >
            {VIEW_WORD[one]}
          </button>
        )}
      </For>
    </div>
  );

  /** The parts both shapes draw, each in one place per shape. */
  const age = () => (
    <Tip
      class="pointer-events-auto shrink-0"
      label="How long this piece of work has run"
    >
      <span
        data-testid="work-age"
        class="shrink-0 font-mono text-[0.62rem] tabular-nums text-fg-3"
      >
        {dualPhrase(lifetime(record(), new Date(now()).toISOString()))}
      </span>
    </Tip>
  );
  const subtitle = () => (
    <>
      <p class="m-0 mt-0.5 flex min-w-0 items-center gap-2 font-mono text-[0.62rem] text-fg-3">
        {/* THE SNAPSHOT, like every other fold on this card: the subtitle is
            a fold over the whole record (its setup, its PR), and handed the
            store's own proxy it would subscribe a node per leaf of it. */}
        <WorkSubtitle work={record()} pr={pr()} />
        {/* HOW LONG IT HAS WAITED ON YOU, all told — from a whole second, so a
            setup answered in a blink does not read "you 0s". */}
        <Show when={onYou() >= 1000}>
          <span data-testid="work-on-you" class="shrink-0 text-alert">
            you {dualPhrase(onYou())}
          </span>
        </Show>
      </p>
      <WorkHeld work={props.work} />
    </>
  );
  const title = () => (
    <span
      data-testid="work-card-title"
      class={`min-w-0 flex-1 truncate font-semibold text-fg ${
        props.shape === "picked" ? "text-base" : "text-[0.78rem]"
      }`}
    >
      {props.work.title}
    </span>
  );
  const standing = () => (
    <WorkStanding
      work={record()}
      line={at()}
      now={now()}
      testId="work-standing"
    />
  );
  /** THE MAP — each stage that has happened is a button that picks the work
   *  on that stage's events: an index into the timeline. */
  const map = () => (
    <StageMap
      stages={read()}
      size="full"
      testId="stage-map"
      index={{
        shown: shownStage,
        show: (stage) => {
          setPressed({ kind: "stage", stage });
          setWhole(false);
          if (isOpen()) chooseView("details");
          else pickWork(props.id, stage);
        },
      }}
    />
  );
  /** ITS TERMINALS, ON THE FACE — every work in progress lists them without
   *  being opened. An ended work has none (`live` is the open arm of the
   *  state sum). */
  const terminals = () => (
    <Show when={live() !== undefined}>
      <WorkTerminals work={record()} members={members()} now={now()} />
    </Show>
  );
  /** The face's press: a button laid UNDER the text rather than wrapped
   *  round it, so the PR number the text names can be a link of its own and
   *  the map's stages and the terminals' controls buttons of their own —
   *  the text lets presses through to it, and only those take them. */
  const head = () => (
    <button
      type="button"
      data-testid="work-card-head"
      aria-expanded={isOpen() ? "true" : "false"}
      aria-label={props.work.title}
      class={`absolute inset-0 cursor-pointer ${flat() ? "" : "rounded-xl"}`}
      onClick={() => togglePick(props.id)}
    />
  );

  return (
    <article
      ref={card}
      data-testid="work-card"
      data-shape={props.shape}
      data-work={props.id}
      data-who={at().who}
      data-open={isOpen() ? "" : undefined}
      data-view={isOpen() ? shownView() : undefined}
      data-flash={flash() ? "" : undefined}
      data-state={props.work.state.kind}
      data-outcome={
        props.work.state.kind === "ended"
          ? props.work.state.outcome.kind
          : undefined
      }
      // A card has its own border, and its needs-you edge is the one piece of
      // colour a card on the board carries: a column of works must say which one is
      // on you without being read. A row is one line of its group's table,
      // and its group draws the edges. A work a chip asked for flashes once
      // (`index.css`, `.work-card`).
      class={
        flat()
          ? "work-card min-w-0 scroll-m-3 overflow-hidden bg-surface-0"
          : `work-card min-w-0 scroll-m-3 overflow-hidden rounded-xl border bg-surface-0 ${
              at().who === "you" ? "border-alert/55" : "border-edge"
            }`
      }
    >
      <Show
        when={props.shape === "line"}
        fallback={
          <Show
            when={row()}
            fallback={
              <>
                {/* THE CARD: head, then the map and the card's ways on — the
                chat about it, its link, and its PR while that waits on you. */}
                <div class="relative px-2.5 py-2">
                  {head()}
                  <div class="pointer-events-none relative">
                    <div class="flex min-w-0 items-baseline gap-2">
                      {title()}
                      {age()}
                    </div>
                    {subtitle()}
                    {standing()}
                  </div>
                </div>
                <div class="px-2.5 pb-2">
                  {map()}
                  <WorkCardActions id={props.id} work={record()} />
                  <Show when={isOpen() && live() !== undefined}>{views()}</Show>
                </div>
              </>
            }
          >
            {/* THE ROW: what it is and where; the stage map and where it
            stands; its terminals; its age — side by side on a wide row, the
            terminals dropping under the title on a narrow one. The row's
            OWN width decides (a container query), not the window's: the
            works share the window with the chat and the sidebar, and the
            sidebar's width is the person's. Its press reaches every part
            but the controls inside it. */}
            <div class="@container/row relative px-3 py-2.5">
              {head()}
              <div class="pointer-events-none relative grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] items-start gap-x-5 gap-y-2 @min-[52rem]/row:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.7fr)_auto] [&_a]:pointer-events-auto [&_button]:pointer-events-auto">
                <div class="col-start-1 row-start-1 min-w-0">
                  <div class="flex min-w-0">{title()}</div>
                  {subtitle()}
                </div>
                <div class="col-start-2 row-start-1 min-w-0">
                  {map()}
                  {standing()}
                </div>
                <div class="col-span-full row-start-2 min-w-0 @min-[52rem]/row:col-span-1 @min-[52rem]/row:col-start-3 @min-[52rem]/row:row-start-1">
                  {terminals()}
                </div>
                <div class="col-start-3 row-start-1 @min-[52rem]/row:col-start-4">
                  {age()}
                </div>
              </div>
            </div>
          </Show>
        }
      >
        {/* THE LINE: a finished work in its group's list — what it was and
            where, how it ended, how long it ran, and when it ended, on one
            line. Pressing it picks it, and its details offer Reopen. */}
        <div class="relative px-3 py-1.5">
          {head()}
          <div class="pointer-events-none relative flex min-w-0 items-baseline gap-4 text-[0.74rem]">
            <span class="min-w-0 flex-1 truncate">
              <span class="text-fg">{props.work.title}</span>
              <Show when={repo()}>
                {(name) => (
                  <span class="font-mono text-[0.62rem] text-fg-3">
                    {" · "}
                    {name()}
                  </span>
                )}
              </Show>
            </span>
            <Show when={endedHow()}>
              {(how) => (
                <span
                  data-testid="work-line-outcome"
                  class={`w-32 shrink-0 truncate font-mono text-[0.64rem] max-sm:w-24 ${
                    props.work.state.kind === "ended" &&
                    props.work.state.outcome.kind === "merged"
                      ? "text-accent"
                      : "text-fg-2"
                  }`}
                >
                  {how()}
                </span>
              )}
            </Show>
            <span class="w-14 shrink-0 text-end font-mono text-[0.62rem] tabular-nums text-fg-3 max-sm:hidden">
              {dualPhrase(lifetime(record(), new Date(now()).toISOString()))}
            </span>
            <span class="w-14 shrink-0 text-end font-mono text-[0.62rem] tabular-nums text-fg-3">
              {endedAgo()}
            </span>
          </div>
        </div>
      </Show>

      {/* THE QUESTIONS, ON THE FACE — a work that needs you is answered
          where it stands, without opening it. EVERY open ask, not the
          oldest: a Conductor that asks about a failing check while a plan
          approval is still open has put two things to the human, and a face
          that draws one of them makes the second answerable nowhere. Drawn
          here once, so the picked work does not carry a second copy. */}
      <Show when={live()}>
        {(asking) => (
          <Show when={asking().asks.length > 0}>
            <div data-testid="work-asks" class="px-2.5 pb-2">
              <For each={asking().asks}>
                {(ask) => (
                  <AskSlot ask={ask} boxes={askBoxes}>
                    <WorkQuestion
                      work={record()}
                      id={props.id}
                      ask={ask}
                      from="card"
                    />
                  </AskSlot>
                )}
              </For>
            </div>
          </Show>
        )}
      </Show>

      <Show when={props.shape === "card" && live() !== undefined}>
        <div class="px-2.5 pb-2">{terminals()}</div>
      </Show>

      {/* THE PICKED WORK'S BODY: one view mounted at a time, each for its own
          view only — so with Code or Details in front no live pane is
          mounted, none holds a screen open, and no terminal counts as in
          front for its unread marks. */}
      <Show when={isOpen()}>
        <Switch>
          <Match when={shownView() === "terminals"}>
            <div class="border-t border-edge px-2.5 py-2">
              <WorkLive members={members()} />
            </div>
          </Match>
          <Match when={shownView() === "code"}>
            <div class="border-t border-edge px-2.5 py-2">
              <WorkCode id={props.id} work={props.work} members={members()} />
            </div>
          </Match>
          <Match when={shownView() === "details"}>
            {/* THE DETAILS: its terminals, one row each — each unfolding into
                what is about that terminal — then what is about its worktree,
                once, then the record behind the face. */}
            <div class="border-t border-edge px-2.5 py-2">
              <Show when={live() !== undefined}>
                <div class="mb-2">
                  <WorkTerminals
                    work={record()}
                    members={members()}
                    now={now()}
                    unfolds
                  />
                </div>
              </Show>
              <WorkWorktree work={props.work} pr={pr()} />
              <WorkDetails
                id={props.id}
                work={record()}
                source={source()}
                checks={checks()}
                shown={view()}
                onWhole={() => setWhole((was) => !was)}
                stages={read()}
                trail={{
                  shown: shownVisit,
                  show: (visit) => {
                    setPressed({ kind: "visit", visit });
                    setWhole(false);
                  },
                }}
                now={now()}
              />
            </div>
          </Match>
        </Switch>
      </Show>
    </article>
  );
};

export default WorkCard;
