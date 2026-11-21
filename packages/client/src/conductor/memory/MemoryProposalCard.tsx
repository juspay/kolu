/** A MEMORY THE CONDUCTOR PROPOSED — the one component the chat and the
 *  Memory sheet both draw.
 *
 *  While the memory cell lists it as waiting it is something that needs you:
 *  the violet card with **Remember**, **Edit…** and **Don't**, or, when its
 *  turn proposed several, a one-line row with the same three buttons and its
 *  text one click away. A `replace` names the memory it changes, with that
 *  memory's current text one click away. Once it is settled it is one line
 *  saying how it ended. Whether it waits is read from the cell, never from
 *  the row, so a row that outlived its proposal shows how it ended instead
 *  of buttons that would be refused. */

import type { ConductorMemoryProposalRow } from "kolu-common/conductor";
import type { MemoryChange, MemoryEntry } from "kolu-common/conductorMemory";
import { Markdown } from "@kolu/solid-markdown";
import { type Component, createEffect, createSignal, Show } from "solid-js";
import { CONTEXTUAL_TIPS } from "../../settings/tips";
import { useTips } from "../../settings/useTips";
import { editMemory } from "./MemoryEditor";
import { useMemory } from "./useMemory";

export interface ProposalShown {
  readonly proposal: string;
  readonly title: string;
  readonly change: MemoryChange;
  readonly why: string | null;
  readonly ended: ConductorMemoryProposalRow["ended"];
}

const ENDED: Record<NonNullable<ProposalShown["ended"]>, string> = {
  remembered: "remembered",
  edited: "remembered, edited",
  forgotten: "forgotten",
  declined: "declined",
};

const AboutTag: Component<{ about: string | null }> = (props) => (
  <Show when={props.about}>
    {(about) => (
      <span class="ml-1.5 rounded-sm bg-accent/15 px-1 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-accent">
        {about()}
      </span>
    )}
  </Show>
);

/** WHAT A `replace` CHANGES: the memory it names, by its current title, with
 *  its current text one click away. When that memory is gone, approving adds
 *  this as a new one, and the line says so. */
const Replaces: Component<{ replacing: MemoryEntry | null }> = (props) => {
  const [open, setOpen] = createSignal(false);
  return (
    <div data-testid="memory-proposal-replaces" class="text-fg-3">
      <Show
        when={props.replacing}
        fallback={
          <p class="m-0 text-[0.7rem]">
            The memory this changes was deleted, so it will be added as a new
            memory.
          </p>
        }
      >
        {(entry) => (
          <>
            <p class="m-0 flex items-baseline gap-1.5 text-[0.7rem]">
              <span>Replaces</span>
              <b class="text-fg-2">{entry().title}</b>
              <button
                type="button"
                data-testid="memory-proposal-current"
                aria-expanded={open()}
                class="font-mono text-[0.62rem] text-accent cursor-pointer"
                onClick={() => setOpen((was) => !was)}
              >
                {open() ? "hide it" : "show it"}
              </button>
            </p>
            <Show when={open()}>
              <div class="mt-1 rounded-md border border-edge px-2 py-1 text-fg-3">
                <Markdown markdown={entry().body} variant="compact" />
              </div>
            </Show>
          </>
        )}
      </Show>
    </div>
  );
};

const MemoryProposalCard: Component<{ shown: ProposalShown }> = (props) => {
  const memory = useMemory();
  const [refusal, setRefusal] = createSignal<string | null>(null);
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const waiting = () => memory.waiting(props.shown.proposal) !== undefined;
  const { showTipOnce } = useTips();
  createEffect(() => {
    if (waiting()) showTipOnce(CONTEXTUAL_TIPS.conductorMemory);
  });
  const change = () => props.shown.change;
  const text = () => {
    const now = change();
    return now.kind === "forget" ? null : now;
  };
  /** The memory a `replace` names as it stands now: `null` once it is gone,
   *  `undefined` for a change that replaces nothing. */
  const replacing = (): MemoryEntry | null | undefined => {
    const now = change();
    if (now.kind !== "replace") return undefined;
    return memory.view().entries.find((one) => one.id === now.entry) ?? null;
  };
  const replaces = () => (
    <Show when={replacing() !== undefined}>
      <Replaces replacing={replacing() ?? null} />
    </Show>
  );

  const act = (answered: Promise<string | null>): void => {
    setBusy(true);
    void answered.then((refused) => {
      setBusy(false);
      setRefusal(refused);
    });
  };

  const buttons = () => (
    <div class="flex shrink-0 items-center gap-1.5">
      <button
        type="button"
        data-testid="memory-proposal-remember"
        disabled={busy()}
        class="rounded-md bg-accent px-2.5 py-1 text-[0.7rem] font-semibold text-surface-0 cursor-pointer disabled:opacity-50"
        onClick={() => act(memory.approve(props.shown.proposal, null))}
      >
        {change().kind === "forget" ? "Forget it" : "Remember"}
      </button>
      <Show when={text()}>
        {(words) => (
          <button
            type="button"
            data-testid="memory-proposal-edit"
            disabled={busy()}
            class="rounded-md border border-edge-bright px-2.5 py-1 text-[0.7rem] text-fg-2 hover:text-fg cursor-pointer disabled:opacity-50"
            onClick={() =>
              editMemory({
                kind: "proposal",
                proposal: props.shown.proposal,
                text: {
                  title: words().title,
                  about: words().about,
                  body: words().body,
                },
              })
            }
          >
            Edit…
          </button>
        )}
      </Show>
      <button
        type="button"
        data-testid="memory-proposal-decline"
        disabled={busy()}
        class="rounded-md border border-edge-bright px-2.5 py-1 text-[0.7rem] text-fg-2 hover:text-fg cursor-pointer disabled:opacity-50"
        onClick={() => act(memory.decline(props.shown.proposal))}
      >
        Don't
      </button>
    </div>
  );

  const refused = () => (
    <Show when={refusal()}>
      {(why) => (
        <p
          data-testid="memory-proposal-refusal"
          class="mt-2 rounded-md border border-danger/50 bg-danger/10 px-2.5 py-1.5 text-[0.72rem] text-danger"
        >
          {why()}
        </p>
      )}
    </Show>
  );

  return (
    <div
      data-testid="memory-proposal"
      data-proposal={props.shown.proposal}
      data-waiting={waiting() ? "" : undefined}
      data-ended={props.shown.ended ?? undefined}
    >
      <Show
        when={waiting()}
        fallback={
          <p class="m-0 flex items-baseline gap-1.5 font-mono text-[0.68rem] text-fg-3">
            <span class="text-accent">◆</span>
            <span data-testid="memory-proposal-ended">
              {props.shown.ended === null
                ? "no longer waiting"
                : ENDED[props.shown.ended]}
            </span>
            <span>·</span>
            <span class="font-sans text-[0.8rem] text-fg-2">
              {props.shown.title}
            </span>
          </p>
        }
      >
        <Show
          when={memory.inBatch(props.shown.proposal) <= 1}
          fallback={
            <div class="rounded-lg border border-alert/45 bg-alert/[0.06] px-3 py-2 text-xs">
              {/* The buttons WRAP under the title rather than squeeze it:
                  the chat is a panel of fixed measure (21rem on a narrow
                  desktop), too narrow for a title and three buttons on one
                  line, while the Memory sheet and a wide panel have room. */}
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                <button
                  type="button"
                  aria-expanded={open()}
                  data-testid="memory-proposal-unfold"
                  class="text-fg-3 cursor-pointer"
                  onClick={() => setOpen((was) => !was)}
                >
                  {open() ? "▾" : "▸"}
                </button>
                <div class="min-w-[10rem] flex-1">
                  <b class="text-[0.8rem] text-fg">{props.shown.title}</b>
                  <AboutTag about={text()?.about ?? null} />
                  <Show when={props.shown.why}>
                    {(why) => (
                      <p class="m-0 font-mono text-[0.62rem] text-fg-3">
                        {why()}
                      </p>
                    )}
                  </Show>
                  {replaces()}
                </div>
                <div class="ms-auto">{buttons()}</div>
              </div>
              <Show when={open() && text()}>
                {(words) => (
                  <div class="mt-1.5 pl-5 text-fg-2">
                    <Markdown markdown={words().body} variant="compact" />
                  </div>
                )}
              </Show>
              {refused()}
            </div>
          }
        >
          <section class="rounded-xl border border-alert/55 bg-alert/[0.08] px-3 py-2.5 text-xs">
            <header class="mb-1 flex items-center gap-2">
              <span class="text-alert text-base leading-none">✱</span>
              <b class="text-[0.78rem]">
                {change().kind === "forget"
                  ? "Conductor would like to forget"
                  : replacing()
                    ? "Conductor would like to change a memory"
                    : "Conductor would like to remember"}
              </b>
            </header>
            {replaces()}
            <p class="m-0 text-[0.82rem] font-semibold text-fg">
              {props.shown.title}
              <AboutTag about={text()?.about ?? null} />
            </p>
            <Show when={text()}>
              {(words) => (
                <div class="mt-0.5 text-fg-2">
                  <Markdown markdown={words().body} variant="compact" />
                </div>
              )}
            </Show>
            <Show when={props.shown.why}>
              {(why) => (
                <p class="mt-1 font-mono text-[0.62rem] text-fg-3">
                  why · {why()}
                </p>
              )}
            </Show>
            {refused()}
            <div class="mt-2">{buttons()}</div>
            <p class="mt-1.5 font-mono text-[0.6rem] text-fg-3">
              Nothing is remembered until you choose.
            </p>
          </section>
        </Show>
      </Show>
    </div>
  );
};

export default MemoryProposalCard;
