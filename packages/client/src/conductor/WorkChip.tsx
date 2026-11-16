/** A PIECE OF WORK, NAMED — the one way the Conductor's screen names a work
 *  outside its own card: on a chat turn, in a "which work?" menu, in the
 *  reader's header.
 *
 *  A dot and the work's title. The dot is who the work is waiting on (the
 *  standing line's colour; violet, and pulsing, when it is you) or the
 *  finished colour once it is over. Pressing it brings the work's card into
 *  view (`showWork`): the listing opens it, scrolls to it, and on a narrow
 *  window comes out first. A menu that offers works to choose between hands
 *  in its own press instead.
 *
 *  Hover or keyboard focus shows where the work stands without leaving the
 *  chat: its subtitle and age, the card's own standing line, and the small
 *  stage strip — drawn by the same components the card draws, so the two
 *  cannot disagree. The hover card is the repo's tooltip (Corvu), mounted
 *  only while open, so a chat full of chips reads nothing it does not show. */

import Tooltip from "@corvu/tooltip";
import { dualPhrase } from "@kolu/terminal-vocab/duration";
import { Option } from "effect";
import { lifetime, type Work, type WorkId } from "kolu-work";
import { type Component, createMemo } from "solid-js";
import { fleetTerminalStanding } from "../palette/fleetTerminals";
import { useShownClock } from "../ui/shown";
import { splitMemberRef } from "./memberRef";
import StageStrip from "./StageStrip";
import { useWorkMembers } from "./useWorks";
import { showWork } from "./workListing";
import {
  checksTally,
  livePrOf,
  membersIn,
  standingLine,
  WORK_DOT,
  workHost,
  workSubtitle,
} from "./workReadings";
import WorkStanding from "./WorkStanding";

/** WHAT THE HOVER CARD SAYS — its own component so that nothing in it is
 *  read until it opens. */
const WorkChipCard: Component<{ id: WorkId; work: Work }> = (props) => {
  const now = useShownClock();
  const allMembers = useWorkMembers();
  const line = createMemo(() => {
    const members = membersIn(allMembers(), props.id).map((row) => {
      const split = splitMemberRef(row.terminal);
      return {
        standing:
          split === null
            ? undefined
            : fleetTerminalStanding(split.host, split.id),
      };
    });
    return standingLine(
      props.work,
      checksTally(Option.fromNullishOr(livePrOf(members))),
    );
  });
  return (
    <>
      <span class="block text-[0.78rem] font-semibold text-fg">
        {props.work.title}
      </span>
      <span class="block truncate font-mono text-[0.62rem] text-fg-3">
        {[
          ...workSubtitle(props.work, workHost(props.work)),
          dualPhrase(lifetime(props.work, new Date(now()).toISOString())),
        ].join(" · ")}
      </span>
      <WorkStanding line={line()} now={now()} />
      <StageStrip work={props.work} now={now()} size="mini" />
    </>
  );
};

const WorkChip: Component<{
  /** The id the work is filed under. */
  id: WorkId;
  work: Work;
  /** What a press does, when it is not bringing the work into view — a menu
   *  offering works to choose between says what choosing one means. */
  onPress?: () => void;
  /** Whether hovering shows where the work stands. A menu of chips shows
   *  the choice and nothing over it. */
  hover?: boolean;
  /** A window with no listing to bring the work into (the reader popped out
   *  on its own) names the work and shows where it stands, and is not a
   *  button: there is nowhere for a press to go. */
  pressable?: boolean;
}> = (props) => {
  /** Who the dot is for — the same reading the card's standing line makes,
   *  without the live check tally the dot has no use for. */
  const who = createMemo(() => standingLine(props.work, Option.none()).who);
  const pressable = () => props.pressable !== false;
  const press = (event: MouseEvent): void => {
    if (!pressable()) return;
    // A chip can sit in a wake-up's one-line summary: pressing it is not
    // opening the account underneath.
    event.preventDefault();
    if (props.onPress !== undefined) props.onPress();
    else showWork(props.id, props.work.state.kind === "ended");
  };
  return (
    <Tooltip
      openDelay={250}
      closeDelay={100}
      openOnHover={props.hover !== false}
      openOnFocus={props.hover !== false}
      placement="bottom-start"
    >
      <Tooltip.Trigger
        as={pressable() ? "button" : "span"}
        type={pressable() ? "button" : undefined}
        tabIndex={pressable() ? undefined : 0}
        data-testid="work-chip"
        data-work={props.id}
        data-who={who()}
        class={`inline-flex max-w-full min-w-0 items-center gap-1.5 rounded-full border border-edge-bright bg-surface-0 py-px pe-2 ps-1.5 align-baseline font-sans text-[0.72rem] font-medium text-fg focus-visible:outline-2 focus-visible:outline-accent ${
          pressable() ? "cursor-pointer hover:border-accent" : ""
        }`}
        onClick={press}
      >
        <span
          aria-hidden="true"
          class={`h-2 w-2 shrink-0 rounded-full ${WORK_DOT[who()]}`}
        />
        <span class="min-w-0 max-w-[36ch] truncate">{props.work.title}</span>
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
};

export default WorkChip;
