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
import { cardOnScreenKey, trackOnScreen } from "./onScreen";
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

const MEMBER_CONTROL =
  "shrink-0 cursor-pointer rounded-sm px-1.5 py-[0.1rem] font-mono text-[0.56rem] font-semibold uppercase tracking-[0.06em] transition-colors";

const STOP_COPY =
  "The work is marked stopped and its terminals are released. Nothing is deleted — its decisions and its timeline stay, and you can open it again.";

const AskSlot: Component<{
  ask: string;
  boxes: Map<string, HTMLElement>;
  children: JSX.Element;
}> = (props) => {
  let box!: HTMLDivElement;
  onMount(() => props.boxes.set(props.ask, box));
  onCleanup(() => props.boxes.delete(props.ask));
  return (
    <div ref={box} data-testid="work-ask-slot" class="mb-2.5 scroll-m-3">
      {props.children}
    </div>
  );
};

const WorkCard: Component<{
  id: WorkId;
  work: Work;
}> = (props) => {
  const now = useShownClock();
  const seen = useSeen();
  const openTileAt = useOpenTile();
  const membership = useMembership();
  const allMembers = useWorkMembers();
  const conductor = useConductor();

  const isOpen = () => isCardOpen(props.id);

  let card!: HTMLElement;
  const askBoxes = new Map<string, HTMLElement>();
  const onScreen = useShown();
  const trackCard = trackOnScreen(() => cardOnScreenKey(props.id), onScreen);
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
    setFlash(false);
    clearTimeout(unflash);
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      frame = undefined;
      const question = want.ask === null ? undefined : askBoxes.get(want.ask);
      (question ?? card).scrollIntoView({ block: "nearest" });
      setFlash(true);
      unflash = window.setTimeout(() => setFlash(false), 1200);
    });
  });

  const endedArm = createMemo(() => {
    const state = props.work.state;
    return state.kind === "ended" ? state : undefined;
  });

  const openArm = createMemo(() =>
    props.work.state.kind === "open"
      ? {
          members: membersIn(allMembers(), props.id),
          asks: openAsks(props.work),
        }
      : undefined,
  );

  const members = createMemo(() =>
    (openArm()?.members ?? []).map((row) => {
      const split = splitMemberRef(row.terminal);
      const standing =
        split === null
          ? undefined
          : fleetTerminalStanding(split.host, split.id);
      return { ...row, split, standing };
    }),
  );

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
  const onYou = createMemo(() =>
    props.work.state.kind === "open"
      ? timeSpentOnYou(props.work, new Date(now()).toISOString())
      : 0,
  );

  const source = createMemo(() =>
    workFileSource(props.id, props.work, members()),
  );

  const at = createMemo(() => standingLine(props.work, checks()));

  const read = createMemo(() =>
    stagesOf(props.work, new Date(now()).toISOString()),
  );
  const [pressed, setPressed] = createSignal<StageName | undefined>();
  const [whole, setWhole] = createSignal(false);
  const [allFailing, setAllFailing] = createSignal(false);
  createEffect(() => {
    if (isOpen()) return;
    setPressed(undefined);
    setWhole(false);
    setAllFailing(false);
  });
  const view = createMemo(() =>
    timelineShown(props.work, read(), pressed(), whole()),
  );
  const shownStage = (): StageName | undefined => {
    const shown = view().view;
    return isOpen() && shown.kind === "stage" && shown.stage !== "setup"
      ? shown.stage
      : undefined;
  };

  return (
    <article
      ref={(el) => {
        card = el;
        trackCard(el);
      }}
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
      class={`work-card min-w-0 scroll-m-3 overflow-hidden rounded-xl border bg-surface-0 ${
        at().who === "you" ? "border-alert/55" : "border-edge"
      }`}
    >
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
            <span data-testid="work-subtitle" class="min-w-0 flex-1 truncate">
              <PrText
                work={props.work}
                text={workSubtitle(props.work, workHost(props.work)).join(
                  " · ",
                )}
              />
            </span>
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
        <div class="border-t border-edge px-2.5 py-2">
          <Show when={openArm()}>
            {(asking) => (
              <>
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
                          const driver = (): Lock | undefined => {
                            const at = membership().get(one.terminal);
                            return at === undefined || at.driver === "nobody"
                              ? undefined
                              : at.driver;
                          };
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

          <Show when={endedArm()}>
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
            kept={endedArm() !== undefined}
            notKept={Option.getOrUndefined(notKeptOf(props.work))}
          />

          <Show when={Option.getOrUndefined(prSection(props.work, checks()))}>
            {(pr) => (
              <section data-testid="work-pr" class="mt-2.5">
                <h4 class="m-0 font-mono text-[0.58rem] uppercase tracking-[0.1em] text-fg-3">
                  Pull request
                </h4>
                <p
                  data-testid="work-pr-state"
                  data-state={pr().state}
                  data-draft={pr().draft}
                  class="m-0 mt-1 text-[0.68rem] text-fg"
                >
                  <PrText work={props.work} text={`#${pr().number}`} />
                  <span class="text-fg-2">
                    {" "}
                    · {pr().state}
                    {pr().draft ? " · draft" : ""}
                  </span>
                </p>
                <p
                  data-testid="work-pr-checks"
                  class="m-0 text-[0.68rem] text-fg-2"
                >
                  {pr().checks}
                </p>
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

          <Show when={endedArm() !== undefined}>
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

          <div class="mt-3 border-t border-edge pt-2">
            <Show
              when={openArm() !== undefined}
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
