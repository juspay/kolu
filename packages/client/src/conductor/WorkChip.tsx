import Tooltip from "@corvu/tooltip";
import { dualPhrase } from "@kolu/terminal-vocab/duration";
import { Option } from "effect";
import { lifetime, type Work, type WorkId } from "kolu-work";
import { type Component, createMemo } from "solid-js";
import { fleetTerminalStanding } from "../palette/fleetTerminals";
import { useShownClock } from "../ui/shown";
import { splitMemberRef } from "./memberRef";
import PrText from "./PrText";
import StageStrip from "./StageStrip";
import { useWorkMembers } from "./useWorks";
import WorkChipFace from "./WorkChipFace";
import { aboutWork } from "./chatScope";
import { showWork } from "./workListing";
import { checksTally, livePrOf } from "./prReadings";
import {
  membersIn,
  stagesOf,
  standingLine,
  workHost,
  workSubtitle,
} from "./workReadings";
import WorkStanding from "./WorkStanding";

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
      <StageStrip
        stages={stagesOf(props.work, new Date(now()).toISOString())}
        size="mini"
        testId="chip-stage-strip"
      />
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
