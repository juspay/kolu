/** The Agents row's profile field: one text input, its suggestions in a
 *  Kolu-drawn menu (`profileSuggestions` — Juspay's profile, every bundle kolu
 *  ships, then what was set before), and the lines under it — whether
 *  agent-distro resolves the profile on this machine (`agentsResolvedLine`:
 *  pending, resolved, or its own words, red, when it does not), then the
 *  agents with their versions and that a repository's own `agent-distro.nix`
 *  overrides it (`agentsProfileNotes`).
 *
 *  The menu opens from the chevron inside the field's right edge, or by
 *  typing (which filters it) or ↓. ↑/↓ move, Enter picks the row in view —
 *  or, with no row in view, writes the text — and a click picks a row; a pick
 *  hands the value to the caller, which writes it whole. The field never
 *  refuses what it is given. Escape closes the menu and puts the stored
 *  profile back; so does leaving the field, so a half-typed profile is never
 *  written. The menu is portalled over the lines under the field, in the
 *  shared popover scaffold (`useAnchoredPopover`, `surface()`); Settings
 *  counts a click inside it as inside itself. */

import {
  AGENTS_UNRESOLVED_MEANS,
  type AgentsResolvedLine,
  type ProfileSuggestion,
} from "@kolu/agent-distro/status";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import { ChevronDownIcon } from "../ui/Icons";
import { surface } from "../ui/Surface";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";

/** The menu's test id — Settings' outside-click dismiss reads it, so a pick
 *  in this portalled menu does not close Settings. */
export const AGENTS_PROFILE_MENU_TESTID = "agents-profile-menu";

/** The rows that match `text` — its value or note contains it, any case. */
function matching(
  suggestions: readonly ProfileSuggestion[],
  text: string,
): readonly ProfileSuggestion[] {
  const needle = text.trim().toLowerCase();
  return suggestions.filter(
    (s) =>
      s.value.toLowerCase().includes(needle) ||
      s.note.toLowerCase().includes(needle),
  );
}

const AgentsProfileField: Component<{
  /** The stored profile — the field's text until the user edits it, and
   *  again whenever it changes. */
  profile: string;
  suggestions: readonly ProfileSuggestion[];
  resolved: AgentsResolvedLine | undefined;
  notes: readonly string[];
  /** Write `text` as the profile (the caller trims it and drops a no-op). */
  onSubmit: (text: string) => void;
}> = (props) => {
  const [draft, setDraft] = createSignal(props.profile);
  // A write from anywhere (this field, another tab, a migration) is what the
  // field shows next.
  createEffect(on(() => props.profile, setDraft, { defer: true }));
  const [open, setOpen] = createSignal(false);
  // Typing filters; the chevron shows every row.
  const [filtering, setFiltering] = createSignal(false);
  const [active, setActive] = createSignal<number | undefined>();
  const rows = createMemo(() =>
    filtering() ? matching(props.suggestions, draft()) : props.suggestions,
  );
  let field: HTMLDivElement | undefined;
  let input: HTMLInputElement | undefined;

  const show = (filter: boolean) => {
    setFiltering(filter);
    setActive(undefined);
    setOpen(true);
  };
  const close = () => {
    setOpen(false);
    setActive(undefined);
  };
  /** Back to the stored profile, menu closed: nothing is written. */
  const revert = () => {
    close();
    setDraft(props.profile);
  };
  const pick = (value: string) => {
    close();
    setDraft(value);
    props.onSubmit(value);
  };
  const move = (step: 1 | -1) => {
    const count = rows().length;
    if (count === 0) return;
    const at = active();
    setActive(
      at === undefined
        ? step === 1
          ? 0
          : count - 1
        : (at + step + count) % count,
    );
  };

  const { panelRef, panelStyle } = useAnchoredPopover({
    triggerRef: () => field,
    open,
    onDismiss: close,
    anchor: "bottom-start",
  });
  const chrome = surface({ radius: "lg", shadow: "light", portalled: true });

  return (
    <div class="mt-2 flex flex-col gap-1" data-testid="agents-profile">
      <div class="flex items-center gap-2.5">
        <label
          for="agents-profile-input"
          class="w-14 shrink-0 text-xs font-medium text-fg-2"
        >
          Profile
        </label>
        <div ref={field} class="relative min-w-0 max-w-[28rem] flex-1">
          <input
            ref={input}
            id="agents-profile-input"
            type="text"
            role="combobox"
            aria-expanded={open()}
            aria-controls="agents-profile-options"
            aria-autocomplete="list"
            aria-activedescendant={
              active() === undefined
                ? undefined
                : `agents-profile-option-${active()}`
            }
            spellcheck={false}
            autocomplete="off"
            data-testid="agents-profile-input"
            class="h-8 w-full rounded-lg border border-edge bg-surface-1 pl-2.5 pr-8 font-mono text-xs text-fg placeholder:text-fg-3 transition-colors focus:border-accent/50 focus:bg-surface-2 focus:outline-none"
            classList={{
              "border-danger/60": props.resolved?.kind === "failed",
            }}
            placeholder="github:owner/repo or ~/my-profile"
            value={draft()}
            onInput={(e) => {
              setDraft(e.currentTarget.value);
              show(true);
            }}
            // Native, so Escape can stop here: with the menu open it closes
            // the menu, not Settings around it.
            on:keydown={(e) => {
              switch (e.key) {
                case "ArrowDown":
                case "ArrowUp":
                  e.preventDefault();
                  if (!open()) show(false);
                  move(e.key === "ArrowDown" ? 1 : -1);
                  return;
                case "Enter": {
                  const at = active();
                  const row = at === undefined ? undefined : rows()[at];
                  if (open() && row !== undefined) pick(row.value);
                  else {
                    close();
                    props.onSubmit(draft());
                  }
                  return;
                }
                case "Escape":
                  if (open()) e.stopPropagation();
                  revert();
                  return;
              }
            }}
            onBlur={revert}
          />
          <button
            type="button"
            data-testid="agents-profile-chevron"
            aria-label="Show profile suggestions"
            aria-expanded={open()}
            aria-controls="agents-profile-options"
            tabIndex={-1}
            class="absolute inset-y-0 right-0 flex w-8 items-center justify-center rounded-r-lg text-fg-3 transition-colors hover:text-fg cursor-pointer"
            // Keep the focus in the input: a blur there would revert.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (open()) close();
              else show(false);
              input?.focus();
            }}
          >
            <ChevronDownIcon class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <Show when={open() && rows().length > 0}>
        <Portal>
          <div
            ref={panelRef}
            id="agents-profile-options"
            role="listbox"
            data-testid={AGENTS_PROFILE_MENU_TESTID}
            class={`fixed z-50 flex max-h-60 flex-col overflow-y-auto p-1 ${chrome.class}`}
            style={{
              ...panelStyle(),
              ...chrome.style,
              width: `${field?.offsetWidth ?? 0}px`,
            }}
          >
            <For each={rows()}>
              {(row, i) => (
                <button
                  type="button"
                  tabIndex={-1}
                  id={`agents-profile-option-${i()}`}
                  role="option"
                  aria-selected={active() === i()}
                  data-testid="agents-profile-option"
                  data-value={row.value}
                  data-active={active() === i() ? "" : undefined}
                  class="flex cursor-pointer items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-xs"
                  classList={{
                    "bg-surface-3 text-fg": active() === i(),
                    "text-fg-2 hover:bg-surface-2": active() !== i(),
                  }}
                  // Keep the focus in the input: a blur there would revert.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i())}
                  onClick={() => pick(row.value)}
                >
                  <span class="shrink-0 font-mono">{row.value}</span>
                  <span class="min-w-0 truncate text-fg-3/70">{row.note}</span>
                </button>
              )}
            </For>
          </div>
        </Portal>
      </Show>
      <div class="ml-[4.125rem] flex min-w-0 flex-col gap-0.5 text-xs leading-relaxed">
        <Show when={props.resolved}>
          {(line) => (
            <div data-testid="agents-resolved" data-kind={line().kind}>
              <p
                title={line().text}
                class="truncate"
                classList={{
                  "text-fg-3/70 italic": line().kind === "pending",
                  "text-fg-2": line().kind === "resolved",
                  "text-danger": line().kind === "failed",
                }}
              >
                {line().text}
              </p>
              <Show when={line().kind === "failed"}>
                <p class="text-fg-3/70">{AGENTS_UNRESOLVED_MEANS}</p>
              </Show>
            </div>
          )}
        </Show>
        <For each={props.notes}>
          {(note) => <p class="text-fg-3/70">{note}</p>}
        </For>
      </div>
    </div>
  );
};

export default AgentsProfileField;
