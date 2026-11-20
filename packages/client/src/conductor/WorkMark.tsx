import { type Component, Show } from "solid-js";
import { workLink } from "../deepLink";
import { useMembership } from "./useWorks";
import { showWork } from "./workListing";
import { ROLE_WORD } from "./workReadings";

const WorkMark: Component<{
  terminal: string;
}> = (props) => {
  const membership = useMembership();
  return (
    <Show when={membership().get(props.terminal)}>
      {(at) => (
        <a
          href={workLink(at().work)}
          data-testid="work-mark"
          data-role={at().role}
          data-work={at().work}
          data-driver={at().driver}
          title={`${ROLE_WORD[at().role]} of “${at().title}”${
            at().driver === "you" ? " · taken over by you" : ""
          } — go to the work`}
          class={`inline-flex shrink-0 items-center gap-1 rounded-sm px-1 font-mono text-[0.55rem] font-semibold uppercase leading-[1.4] tracking-[0.06em] align-[0.05em] no-underline hover:underline ${
            at().driver === "you"
              ? "bg-alert/15 text-alert"
              : "bg-conductor/15 text-conductor"
          }`}
          onClick={(event) => {
            event.stopPropagation();
            if (event.metaKey || event.ctrlKey || event.shiftKey) return;
            event.preventDefault();
            showWork(at().work);
          }}
        >
          <span aria-hidden="true">◆</span>
          {ROLE_WORD[at().role]}
        </a>
      )}
    </Show>
  );
};

export default WorkMark;
