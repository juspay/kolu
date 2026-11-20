import type { ConductorRow, ConductorState } from "kolu-common/conductor";
import { isOpen } from "kolu-work";
import { type Component, createMemo, Show } from "solid-js";
import { formatKeybind } from "../input/keyboard";
import Tip from "../ui/Tip";
import WorkColumn from "./WorkColumn";
import { useNeedsYou, useWorks } from "./useWorks";
import { isListingOut, toggleListing } from "./workListing";
import { waitingCount, worksStatusWords } from "./workReadings";
import { conductorWide } from "./conductorLayout";
import { useShownClock } from "../ui/shown";
import { STEER_KEYBIND, steerOnOffer } from "./steer";
import { statusDetail, statusSince } from "./statusReadout";
import { CONDUCTOR_TEST_ID } from "./conductorTestIds";

const PHASE_CLASS: Record<ConductorState["phase"], string> = {
  offline: "text-fg-3",
  starting: "text-fg-2",
  idle: "text-fg-3",
  working: "text-busy",
  asking: "text-alert",
};

const DOT_CLASS: Record<ConductorState["phase"], string> = {
  offline: "bg-fg-3/50",
  starting: "bg-fg-2 animate-pulse motion-reduce:animate-none",
  idle: "bg-fg-3/50",
  working: "bg-busy animate-pulse motion-reduce:animate-none",
  asking: "bg-alert",
};

const ConductorStatus: Component<{
  state: ConductorState;
  rows: readonly ConductorRow[];
}> = (props) => {
  const now = useShownClock();
  const detail = createMemo(() => statusDetail(props.state.phase, props.rows));
  const since = createMemo(() =>
    statusSince(props.state.phase, props.state.busySince, now()),
  );
  const listingOut = isListingOut;
  const works = useWorks();
  const needs = useNeedsYou();
  const pieces = createMemo(
    () => works().filter(([, one]) => isOpen(one)).length,
  );
  const waiting = createMemo(() => waitingCount(needs(), props.state.openAsks));
  const words = createMemo(() => {
    const said = worksStatusWords(pieces(), waiting());
    return said === "" ? undefined : said;
  });
  const held = () => props.state.held.length;
  const opensColumnHere = () =>
    listingOut() && !conductorWide() && works().length > 0;
  const steers = createMemo(() => steerOnOffer(props.state));

  return (
    <>
      <Show when={opensColumnHere()}>
        <WorkColumn placement="inline" />
      </Show>
      <div
        data-testid={CONDUCTOR_TEST_ID.status}
        data-phase={props.state.phase}
        class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-t border-edge px-5 py-1.5 font-mono text-[0.65rem] leading-4"
      >
        <span
          class={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASS[props.state.phase]}`}
          aria-hidden="true"
        />
        <span
          data-testid={CONDUCTOR_TEST_ID.statusPhase}
          data-phase={props.state.phase}
          class={`shrink-0 font-semibold ${PHASE_CLASS[props.state.phase]}`}
        >
          {props.state.phase}
        </span>
        <Show when={detail()}>
          {(words) => (
            <span
              data-testid={CONDUCTOR_TEST_ID.statusDetail}
              class="min-w-0 flex-1 truncate text-fg-2"
            >
              {words()}
            </span>
          )}
        </Show>
        <Show when={since()}>
          {(elapsed) => (
            <Tip
              class="flex items-center"
              label="How long this turn has been running"
            >
              <span
                data-testid={CONDUCTOR_TEST_ID.statusSince}
                class="shrink-0 text-fg-3 tabular-nums"
              >
                {elapsed()}
              </span>
            </Tip>
          )}
        </Show>
        <span class="flex-1" />
        <Show when={steers()}>
          <Tip
            class="flex items-center"
            label="Your words go into the turn that is running, instead of queueing behind it"
          >
            <span
              data-testid={CONDUCTOR_TEST_ID.statusSteerHint}
              class="shrink-0 text-accent"
            >
              ↯ {formatKeybind(STEER_KEYBIND)} steers
            </span>
          </Tip>
        </Show>
        <Show when={words() !== undefined || opensColumnHere()}>
          <Tip
            class="flex items-center"
            label="The pieces of work kolu has in flight, and how many things are now waiting on an answer from you"
          >
            <Show
              when={!conductorWide()}
              fallback={
                <span
                  data-testid={CONDUCTOR_TEST_ID.statusWorkCount}
                  data-work={pieces() > 0 ? pieces() : undefined}
                  data-waiting={waiting() > 0 ? waiting() : undefined}
                  class="shrink-0 text-fg-2"
                >
                  {words()}
                </span>
              }
            >
              <button
                type="button"
                data-testid={CONDUCTOR_TEST_ID.statusWorkCount}
                data-work={pieces() > 0 ? pieces() : undefined}
                data-waiting={waiting() > 0 ? waiting() : undefined}
                aria-expanded={listingOut()}
                class="shrink-0 rounded-md border border-edge-bright px-1.5 py-px text-fg-2 hover:text-fg hover:bg-surface-2 cursor-pointer"
                onClick={toggleListing}
              >
                {words() ?? "Hide work"}
              </button>
            </Show>
          </Tip>
        </Show>
        <Show when={held() > 0}>
          <Tip
            class="flex items-center"
            label="Watched terminals that rang while a turn was running — they arrive together when it ends"
          >
            <span
              data-testid={CONDUCTOR_TEST_ID.statusHeld}
              class="shrink-0 rounded-md bg-attention/20 px-1.5 py-px font-semibold text-attention tabular-nums"
            >
              {held()} waiting
            </span>
          </Tip>
        </Show>
      </div>
    </>
  );
};

export default ConductorStatus;
