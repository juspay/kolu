/** THE PICKED WORK'S TERMINALS, LIVE — the Terminals view of a picked work.
 *
 *  One or two terminals stack, a pane each. Three or more, or a window
 *  narrower than 1280px — a phone's always is — show one pane with a tab per
 *  terminal, the key bar under it while that terminal is the person's. Which
 *  panes hold a read of their screen is `livePanes.ts`'s answer: only the
 *  ones a person can see.
 *
 *  A PANE IS KEYED BY ITS TERMINAL'S REF, never by the member row it was
 *  drawn from: the rows are read again whenever a terminal's state moves,
 *  and a pane redrawn on each of those would drop its screen and read it
 *  again from the start. */

import { createMediaQuery } from "@solid-primitives/media";
import type { WorkRole } from "kolu-work";
import type { JSX } from "@solidjs/web";
import { type Component, createMemo, createSignal, For, Show } from "solid-js";
import { useShown } from "../ui/shown";
import LivePane from "./LivePane";
import MemberPip from "./MemberPip";
import { connectedPanes, frontPane, paneHeight, paneLayout } from "./livePanes";
import { useMemberName } from "./memberNames";
import { type MemberRef, splitMemberRef } from "./memberRef";
import type { MemberLine } from "./workFacts";
import { ROLE_WORD } from "./workReadings";

/** The width two panes side by side need — `--breakpoint-conductor-md`. */
const atWide = createMediaQuery("(min-width: 80rem)");

const WorkLive: Component<{
  members: ReadonlyArray<MemberLine>;
}> = (props) => {
  const shown = useShown();
  const name = useMemberName();
  /** The terminals a pane can be drawn for — the ones this browser can
   *  reach — by ref, in the order the waterfall runs them.
   *
   *  ONE PANE PER MEMBER ROW, and one row per terminal: the rows come from
   *  `membersByWork` (`workReadings.ts:309-320`), which reads the ONE members
   *  map, keyed by terminal, so a ref cannot arrive twice. That invariant is
   *  pinned where it is produced (`workReadings.test.ts`) rather than guarded
   *  here: a ref that did arrive twice would attach its stream twice and
   *  leave every readout matching two elements, and dropping the second row
   *  here would hide that instead of showing it. */
  const refs = createMemo(() =>
    props.members.flatMap((one) => (one.split === null ? [] : [one.terminal])),
  );
  const roleOf = (ref: string): WorkRole | undefined =>
    props.members.find((one) => one.terminal === ref)?.member.role;
  const layout = () => paneLayout(refs().length, !atWide());
  const [chosenTab, setChosenTab] = createSignal<string | undefined>();
  const front = () => frontPane(refs(), chosenTab());
  const connected = createMemo(
    () =>
      new Set(
        connectedPanes({
          shown: shown(),
          picked: true,
          view: "terminals",
          layout: layout(),
          refs: refs(),
          front: front(),
        }),
      ),
  );
  const height = () => paneHeight(layout(), refs().length);

  /** One pane, for the terminal at `ref`.
   *
   *  The split ref is a VALUE, not an accessor: `ref` is the row's own
   *  identity, and `splitMemberRef` is a pure split of that string, so the
   *  pair cannot move while this pane lives. Handing an accessor down would
   *  only pay a strict-read window — a component body that reads `props.host`
   *  is such a window — for a change that cannot happen.
   *
   *  `role` IS reactive (`roleOf` reads `props.members`), so it keeps its
   *  `<Show>`: it is read from tracked JSX alone. */
  const pane = (ref: string, at: MemberRef, withTabs: boolean): JSX.Element => (
    <Show when={roleOf(ref)}>
      {(role) => (
        <LivePane
          host={at.host}
          id={at.id}
          role={role()}
          connected={connected().has(ref)}
          height={height()}
          tabs={withTabs ? tabs() : undefined}
        />
      )}
    </Show>
  );

  const tabs = () => (
    <div
      data-testid="live-tabs"
      class="flex min-w-0 shrink-0 items-end gap-0.5 overflow-x-auto border-b border-edge bg-surface-0 px-2 pt-1.5"
    >
      <For each={refs()}>
        {(ref) => (
          <button
            type="button"
            data-testid="live-tab"
            data-ref={ref}
            data-role={roleOf(ref)}
            data-active={ref === front() ? "" : undefined}
            aria-pressed={ref === front() ? "true" : "false"}
            class={`flex h-7 shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-t-lg px-2.5 text-[0.72rem] ${
              ref === front()
                ? "border border-b-0 border-edge-bright bg-surface-1 font-semibold text-fg"
                : "text-fg-2 hover:text-fg"
            }`}
            onClick={() => setChosenTab(ref)}
          >
            <Show when={props.members.find((one) => one.terminal === ref)}>
              {(one) => (
                <Show when={one().split}>
                  {(at) => <MemberPip at={at()} standing={one().standing} />}
                </Show>
              )}
            </Show>
            <Show when={roleOf(ref)}>
              {(role) => (
                <span class="shrink-0 rounded-sm bg-conductor/15 px-1 font-mono text-[0.52rem] font-semibold uppercase tracking-[0.08em] text-conductor">
                  {ROLE_WORD[role()]}
                </span>
              )}
            </Show>
            {name(ref)}
          </button>
        )}
      </For>
    </div>
  );

  return (
    <div data-testid="work-live" data-layout={layout()} class="grid gap-3">
      <Show
        when={refs().length > 0}
        fallback={
          <p class="m-0 rounded-xl border border-edge bg-surface-1 px-3 py-6 text-center text-[0.8rem] text-fg-2">
            This work has no terminal yet.
          </p>
        }
      >
        <Show
          when={layout() === "tabs"}
          fallback={
            <For each={refs()}>
              {(ref) => {
                const at = splitMemberRef(ref);
                return at === null ? null : pane(ref, at, false);
              }}
            </For>
          }
        >
          {/* ONE PANE, KEYED BY THE FRONT TAB: a tab pressed is another
              terminal's screen, read from the start, not the last one's
              screen relabelled. */}
          <Show when={front()} keyed>
            {(ref) => {
              const at = splitMemberRef(ref);
              return at === null ? null : pane(ref, at, true);
            }}
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default WorkLive;
