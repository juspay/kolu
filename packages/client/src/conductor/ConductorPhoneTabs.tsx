/** A PHONE'S TWO TABS under the Conductor — **Work** and **Chat**, one view at
 *  a time (`phoneView.ts`). The Work tab carries how many works need you, in
 *  the needs-you violet, and nothing when none do. */

import { type Component, createMemo, For, Show } from "solid-js";
import { type PhoneView, phoneView, setPhoneView } from "./phoneView";
import { useNeedsYou } from "./useWorks";

const TABS: ReadonlyArray<{ readonly view: PhoneView; readonly word: string }> =
  [
    { view: "work", word: "Work" },
    { view: "chat", word: "Chat" },
  ];

const ConductorPhoneTabs: Component = () => {
  const needs = useNeedsYou();
  /** The works waiting on you — a work with two questions is one. */
  const waiting = createMemo(
    () => new Set(needs().map((one) => one.work)).size,
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
            aria-selected={phoneView() === tab.view}
            class={`relative flex cursor-pointer items-center justify-center gap-1.5 py-3 text-sm font-semibold ${
              phoneView() === tab.view
                ? "text-fg shadow-[inset_0_2px_0_0_var(--color-accent)]"
                : "text-fg-3"
            }`}
            onClick={() => setPhoneView(tab.view)}
          >
            {tab.word}
            <Show when={tab.view === "work" && waiting() > 0}>
              <span
                data-testid="conductor-phone-tab-badge"
                class="rounded-full bg-alert px-1.5 text-[0.65rem] leading-4 text-surface-0 tabular-nums"
              >
                {waiting()}
              </span>
            </Show>
          </button>
        )}
      </For>
    </div>
  );
};

export default ConductorPhoneTabs;
