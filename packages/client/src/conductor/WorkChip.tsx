/** A PIECE OF WORK YOU CAN GO TO — the work's name (`WorkChipFace`) as a
 *  button: on a chat turn, on a question about a work, in the reader's
 *  header, in the bar over a chat pointed at one work, and on the chips in
 *  the box (whose × is a button of its own beside it).
 *
 *  Pressing it picks the work (`showWork`): the reader gives way, a phone
 *  shows its works, and the picked work is scrolled to. On a touch screen
 *  that press is also how a person sees where the work stands — there is no
 *  hover there — so it lands on the work, which says all of it.
 *
 *  Hover or keyboard focus shows where the work stands without leaving the
 *  chat: its subtitle and age, the card's own standing line, one line per
 *  terminal (its mark, its role, its state and for how long, what it runs),
 *  and the small stage strip — drawn by the same components and readings the
 *  card draws, so the two cannot disagree. The hover card is the repo's
 *  tooltip (Corvu), mounted only while open, so its lines are read only
 *  while someone looks at them. */

import Tooltip from "@corvu/tooltip";
import { dualPhrase } from "@kolu/terminal-vocab/duration";
import { lifetime, type Work, type WorkId } from "kolu-work";
import { Key } from "@solid-primitives/keyed";
import { type Component, Show } from "solid-js";
import { elapsedSince } from "../time/duration";
import { useShownClock } from "../ui/shown";
import MemberPip from "./MemberPip";
import PrText from "./PrText";
import StageStrip from "./StageStrip";
import { terminalStatus } from "./terminalStatus";
import { useSeen } from "./useWorks";
import WorkChipFace from "./WorkChipFace";
import { aboutWork } from "./chatScope";
import { showWork } from "./workListing";
import { createWorkFacts, type MemberLine, memberRuns } from "./workFacts";
import { ROLE_WORD, stagesOf, workHost, workSubtitle } from "./workReadings";
import WorkStanding from "./WorkStanding";

/** ONE TERMINAL OF THE WORK, in the hover card: the Dock's mark, its role,
 *  its state and for how long, and what it runs — the readings its row on
 *  the card makes, in one line. */
const TerminalLine: Component<{ work: Work; one: MemberLine; now: number }> = (
  props,
) => {
  const seen = useSeen();
  const since = () => seen().get(props.one.terminal)?.since;
  const runs = () => memberRuns(props.work, props.one);
  return (
    <li
      data-testid="work-chip-terminal"
      data-role={props.one.member.role}
      class="flex min-w-0 items-center gap-1.5 text-[0.68rem]"
    >
      <Show when={props.one.split}>
        {(ref) => <MemberPip at={ref()} standing={props.one.standing} />}
      </Show>
      <span class="shrink-0 font-semibold text-fg">
        {ROLE_WORD[props.one.member.role]}
      </span>
      <span class="min-w-0 truncate text-fg-2">
        {props.one.standing === undefined
          ? "a terminal kolu cannot read"
          : terminalStatus(props.one.standing).state}
        <Show when={since()}>
          {(at) => (
            <span class="tabular-nums text-fg-3">
              {" for "}
              {elapsedSince(at(), props.now)}
            </span>
          )}
        </Show>
      </span>
      <Show when={runs() !== ""}>
        <span class="ms-auto shrink-0 font-mono text-[0.6rem] text-fg-3">
          {runs()}
        </span>
      </Show>
    </li>
  );
};

/** WHAT THE HOVER CARD SAYS — its own component so that nothing in it is
 *  read until it opens. */
const WorkChipCard: Component<{ id: WorkId; work: Work }> = (props) => {
  const now = useShownClock();
  const { members, at: line } = createWorkFacts(
    () => props.id,
    () => props.work,
  );
  return (
    <>
      <span class="block text-[0.78rem] font-semibold text-fg">
        {props.work.title}
      </span>
      <span class="block truncate font-mono text-[0.62rem] text-fg-3">
        <PrText
          work={props.work}
          text={[
            ...workSubtitle(props.work, workHost(props.work)),
            dualPhrase(lifetime(props.work, new Date(now()).toISOString())),
          ].join(" · ")}
        />
      </span>
      <WorkStanding
        work={props.work}
        line={line()}
        now={now()}
        testId="work-chip-standing"
      />
      {/* ITS TERMINALS, one line each — keyed by the terminal, since the
          lines are minted afresh whenever any member's record moves. */}
      <Show when={members().length > 0}>
        <ul class="m-0 mt-1 flex list-none flex-col gap-0.5 p-0">
          <Key each={members()} by="terminal">
            {(one) => (
              <TerminalLine work={props.work} one={one()} now={now()} />
            )}
          </Key>
        </ul>
      </Show>
      <StageStrip
        stages={stagesOf(props.work, new Date(now()).toISOString())}
        size="mini"
        testId="chip-stage-strip"
      />
      {/* THE CHAT ABOUT IT, from where the work was named — there is no card
          to pick here, so this is the chip's own way in. */}
      <button
        type="button"
        data-testid="work-chip-about"
        class="mt-1.5 cursor-pointer rounded-md border border-edge px-1.5 py-px font-mono text-[0.6rem] text-fg-2 hover:border-edge-bright hover:text-fg"
        onClick={() => aboutWork(props.id)}
      >
        About this work
      </button>
    </>
  );
};

const WorkChip: Component<{
  /** The id the work is filed under. */
  id: WorkId;
  work: Work;
}> = (props) => (
  <Tooltip openDelay={250} closeDelay={100} placement="bottom-start">
    <Tooltip.Trigger
      as="button"
      type="button"
      data-testid="work-chip"
      data-work={props.id}
      class="inline-flex max-w-full min-w-0 cursor-pointer rounded-full focus-visible:outline-2 focus-visible:outline-accent hover:[&>span]:border-accent"
      onClick={() => showWork(props.id)}
    >
      <WorkChipFace work={props.work} />
    </Tooltip.Trigger>
    <Tooltip.Portal>
      <Tooltip.Content
        data-testid="work-chip-card"
        data-work={props.id}
        class="z-50 w-[19rem] max-w-[82vw] rounded-lg border border-edge bg-surface-2 px-3 py-2 shadow-lg shadow-black/40"
      >
        <WorkChipCard id={props.id} work={props.work} />
      </Tooltip.Content>
    </Tooltip.Portal>
  </Tooltip>
);

export default WorkChip;
