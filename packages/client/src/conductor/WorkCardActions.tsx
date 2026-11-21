/** A CARD'S WAY OUT — under its stage strip, on every card.
 *
 *  - **Open PR #N ↗**, while a green PR waits on you to merge it: a plain
 *    link out to the forge. The merge itself is yours to press there.
 *
 *  It used to carry **About this work** (picking the card already points the
 *  chat at it) and **Copy link** (the work's address, which no card needs to
 *  hand out when the work is one press away). Both were removed from the
 *  card; the chip that names a work in the conversation still offers
 *  **About this work**, because there is no card to pick there. */

import { Option } from "effect";
import { type GreenPr, needsYouOf, type Work, type WorkId } from "kolu-work";
import { type Component, createMemo, Show } from "solid-js";

const ACTION =
  "cursor-pointer rounded-md border border-edge px-1.5 py-px font-mono text-[0.6rem] text-fg-2 hover:border-edge-bright hover:text-fg";

const WorkCardActions: Component<{ id: WorkId; work: Work }> = (props) => {
  /** The green PR a merge wait is about, with an address to link to. */
  const pr = createMemo((): (GreenPr & { href: string }) | undefined => {
    const wait = Option.getOrUndefined(needsYouOf(props.id, props.work));
    if (wait === undefined || wait.why.why !== "merge") return undefined;
    const green = Option.getOrUndefined(wait.why.pr);
    return green?.link.kind === "link"
      ? { ...green, href: green.link.href }
      : undefined;
  });
  return (
    <div
      data-testid="work-card-actions"
      class="mt-1.5 flex flex-wrap items-center gap-1.5"
    >
      <Show when={pr()}>
        {(green) => (
          <a
            data-testid="work-pr-link"
            href={green().href}
            target="_blank"
            rel="noopener noreferrer"
            class={`${ACTION} border-alert/60 text-alert hover:text-alert`}
          >
            Open PR #{green().number} ↗
          </a>
        )}
      </Show>
    </div>
  );
};

export default WorkCardActions;
