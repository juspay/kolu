/** A WORK'S DETAILS — what a picked work's Details view shows: how it ended
 *  (once it has), the files, the pull request, the decisions, the trail of
 *  every visit and the timeline of one stage or one visit, where the time
 *  went, and the one control at the foot, **Stop** or **Reopen**.
 *
 *  A PART OF ITS OWN so it can be drawn wherever a work's details are asked
 *  for, not only under a card's face. It owns nothing a face also needs: the
 *  stage or visit the timeline shows and whether the whole timeline is out
 *  are the face's (its map and this trail are their index), and handed in;
 *  whether the PR's red gates are unfolded is this part's own, and goes with
 *  it when it closes.
 *
 *  An ENDED work's details say how it ended, what was kept and where the time
 *  went, and offer **Reopen**; a running one's offer **Stop**. */

import { Option } from "effect";
import { notKeptOf, type Stages, type Work, type WorkId } from "kolu-work";
import { type Component, createMemo, createSignal, Show } from "solid-js";
import InlineConfirmButton from "../ui/InlineConfirmButton";
import PrText from "./PrText";
import { type ChecksTally, failingLine, prSection } from "./prReadings";
import type { TimelineShown } from "./timelineView";
import StageTrail from "./StageTrail";
import { useConductor } from "./useConductor";
import WorkDecisions from "./WorkDecisions";
import WorkFiles from "./WorkFiles";
import type { WorkFileSource } from "./workFile";
import { clockOf, outcomeWords, timeSpentWords } from "./workReadings";
import WorkTimeline from "./WorkTimeline";

/** What **Stop** warns about before it acts — the whole of what a person
 *  gives up, and what they do not: the record stays, and Reopen is right
 *  there on the card afterwards. */
const STOP_COPY =
  "The work is marked stopped and its terminals are released. Nothing is deleted — its decisions and its timeline stay, and you can open it again.";

const WorkDetails: Component<{
  id: WorkId;
  /** The record, as the card read it once (`createWorkRecord`): a snapshot,
   *  so the fold below — and everything this hands it to — tracks that one
   *  reading rather than the store's leaves. */
  work: Work;
  /** Where the work's files come from, read once by the face. */
  source: WorkFileSource;
  /** The PR's live check tally, read once by the face for its standing line
   *  too. */
  checks: Option.Option<ChecksTally>;
  /** Which part of the timeline is shown — the face's choice. */
  shown: TimelineShown;
  onWhole: () => void;
  /** The work's stages, read once by the face — the trail is their visits. */
  stages: Stages;
  /** The visit the timeline shows, and how to show another. */
  trail: {
    readonly shown: () => number | undefined;
    readonly show: (visit: number) => void;
  };
  /** The face's clock, so every duration here ticks with the face's. */
  now: number;
}> = (props) => {
  const conductor = useConductor();
  /** HOW IT ENDED, or `undefined` while it is in flight. The state's own arm,
   *  narrowed — not a copy of it. */
  const ended = createMemo(() => {
    const state = props.work.state;
    return state.kind === "ended" ? state : undefined;
  });
  /** Whether the PR's red gates are unfolded from their one line. */
  const [allFailing, setAllFailing] = createSignal(false);
  /** The work's visits, for a work that has stages. */
  const trail = () =>
    props.stages.kind === "staged" ? props.stages.trail : undefined;

  return (
    <div data-testid="work-details">
      {/* HOW IT ENDED, on the card of a work that is over: the outcome in
          the words there are only three of. */}
      <Show when={ended()}>
        {(done) => (
          <section data-testid="work-outcome" class="mb-2.5">
            <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
              Outcome
            </h4>
            <p class="m-0 mt-1 text-[0.7rem] text-fg">
              <PrText work={props.work} text={outcomeWords(done().outcome)} />
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
        source={props.source}
        kept={ended() !== undefined}
        notKept={Option.getOrUndefined(notKeptOf(props.work))}
      />

      {/* THE PULL REQUEST: its number (a link, off the record), how it
          stands, the last check result the timeline kept while no live tally
          speaks (the Work section above says that one), and, while it is
          open, whether GitHub would merge it. */}
      <Show when={Option.getOrUndefined(prSection(props.work, props.checks))}>
        {(pr) => (
          <section data-testid="work-pr" class="mt-2.5">
            <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
              Pull request
            </h4>
            <p
              data-testid="work-pr-state"
              data-state={pr().state}
              data-draft={pr().draft ? "true" : "false"}
              class="m-0 mt-1 text-[0.68rem] text-fg"
            >
              <PrText work={props.work} text={`#${pr().number}`} />
              <span class="text-fg-2">
                {" "}
                · {pr().state}
                {pr().draft ? " · draft" : ""}
              </span>
            </p>
            <Show when={Option.getOrUndefined(pr().checks)}>
              {(checks) => (
                <p
                  data-testid="work-pr-checks"
                  class="m-0 text-[0.68rem] text-fg-2"
                >
                  {checks()}
                </p>
              )}
            </Show>
            {/* THE RED GATES: one line, cut, with the count — the whole
                list in place on a click, and back. */}
            <Show when={pr().failing.length > 0}>
              <button
                type="button"
                data-testid="work-pr-failing"
                aria-expanded={allFailing() ? "true" : "false"}
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

      <Show when={trail()}>
        {(visits) => <StageTrail trail={visits()} index={props.trail} />}
      </Show>

      <WorkTimeline
        id={props.id}
        work={props.work}
        shown={props.shown}
        onWhole={props.onWhole}
        now={props.now}
      />

      {/* WHERE THE TIME WENT, for a work that is over: the map says it by
          stage, this says it by who the work waited on. */}
      <Show when={ended() !== undefined}>
        <section class="mt-2.5">
          <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
            Where the time went
          </h4>
          <p
            data-testid="work-time-spent"
            class="m-0 mt-1 text-[0.68rem] text-fg-2"
          >
            {timeSpentWords(props.work, new Date(props.now).toISOString())}
          </p>
        </section>
      </Show>

      {/* THE ONE CONTROL AT THE FOOT, and which one it is IS the state.
          Stopping is one of the only two ways a work ends on purpose (the
          Conductor's `work_stop` is the other); reopening is how an ended
          one comes back with everything it decided still on it. */}
      <div class="mt-3 border-t border-edge pt-2">
        <Show
          when={ended() === undefined}
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
  );
};

export default WorkDetails;
