/** A PHONE'S TWO TABS under the Conductor — **Work** and **Chat**, one view at
 *  a time (`phoneView.ts`). Each carries, in the needs-you violet, how many
 *  things in it need you, and nothing when none do: the Work tab the works
 *  waiting on you, the Chat tab the memory's proposals — one thing however
 *  many wait, as the Conductor's own tab counts them. */

import { type Component, createMemo, For, Show } from "solid-js";
import { useMemoryNeed } from "./memory/useMemory";
import { type PhoneView, phoneView, setPhoneView } from "./phoneView";
import { useNeedsYou } from "./useWorks";

const TABS: ReadonlyArray<{ readonly view: PhoneView; readonly word: string }> =
  [
    { view: "work", word: "Work" },
    { view: "chat", word: "Chat" },
  ];

const ConductorPhoneTabs: Component = () => {
  const needs = useNeedsYou();
  const memory = useMemoryNeed();
  /** What needs you in each view — a work with two questions is one, and the
   *  memory's proposals are one. */
  const waiting = createMemo(
    (): Record<PhoneView, number> => ({
      work: new Set(needs().map((one) => one.work)).size,
      chat: memory() ? 1 : 0,
    }),
  );
  return (
    <div
      data-testid="conductor-phone-tabs"
      role="tablist"
      aria-label="The Conductor"
      class="grid shrink-0 grid-cols-2 border-t border-edge bg-surface-1"
    >
      <For each={TABS}>
        {(tab) => (
          <button
            type="button"
            role="tab"
            data-testid="conductor-phone-tab"
            data-tab={tab.view}
            aria-selected={phoneView() === tab.view ? "true" : "false"}
            class={`relative flex cursor-pointer items-center justify-center gap-1.5 py-3 text-sm font-semibold ${
              phoneView() === tab.view
                ? "text-fg shadow-[inset_0_2px_0_0_var(--color-accent)]"
                : "text-fg-3"
            }`}
            onClick={() => setPhoneView(tab.view)}
          >
            {tab.word}
            <Show when={waiting()[tab.view] > 0}>
              <span
                data-testid="conductor-phone-tab-badge"
                class="rounded-full bg-alert px-1.5 text-[0.65rem] leading-4 text-surface-0 tabular-nums"
              >
                {waiting()[tab.view]}
              </span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
};

export default ConductorPhoneTabs;
