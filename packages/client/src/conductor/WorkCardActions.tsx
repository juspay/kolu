import { writeTextToClipboard } from "@kolu/solid-logtail";
import { Effect, Option } from "effect";
import { type GreenPr, needsYouOf, type Work, type WorkId } from "kolu-work";
import { type Component, createMemo, Show } from "solid-js";
import { toast } from "solid-sonner";
import { workLink } from "../deepLink";
import { runAction } from "../runAction";
import { aboutWork } from "./chatScope";

const ACTION =
  "cursor-pointer rounded-md border border-edge px-1.5 py-px font-mono text-[0.6rem] text-fg-2 hover:border-edge-bright hover:text-fg";

const WorkCardActions: Component<{ id: WorkId; work: Work }> = (props) => {
  const pr = createMemo((): (GreenPr & { href: string }) | undefined => {
    const wait = Option.getOrUndefined(needsYouOf(props.id, props.work));
    if (wait === undefined || wait.why.why !== "merge") return undefined;
    const green = Option.getOrUndefined(wait.why.pr);
    return green?.link.kind === "link"
      ? { ...green, href: green.link.href }
      : undefined;
  });
  const copy = (): void => {
    runAction(
      "copy a work's link",
      Effect.suspend(() =>
        writeTextToClipboard(
          `${location.origin}${location.pathname}${location.search}${workLink(props.id)}`,
        ),
      ).pipe(
        Effect.tap(() => Effect.sync(() => toast.success("Link copied"))),
        Effect.catch((err) =>
          Effect.sync(() => {
            toast.error(`Could not copy the link: ${err.message}`);
          }),
        ),
      ),
    );
  };
  return (
    <div
      data-testid="work-card-actions"
      class="mt-1.5 flex flex-wrap items-center gap-1.5"
    >
      <button
        type="button"
        data-testid="work-about"
        class={ACTION}
        onClick={() => aboutWork(props.id)}
      >
        About this work
      </button>
      <button
        type="button"
        data-testid="work-copy-link"
        class={ACTION}
        onClick={copy}
      >
        Copy link
      </button>
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
