/** The Agents profile picker: one card per profile kolu offers by name
 *  (`agentProfileCards` — the bundles this build ships, Juspay's reference,
 *  then Custom…), the picked one marked, and under Custom… the reference field
 *  that used to BE this control: a text input, its suggestions in a Kolu-drawn
 *  menu (`profileSuggestions` — what was set before), and whether agent-distro
 *  resolves what it holds (`agentsResolvedLine`: pending, resolved, or its own
 *  words, red, when it does not).
 *
 *  A card is a radio: ←/→/↑/↓ move between them, Enter or a click picks. A
 *  pick hands the profile to the caller, which writes it whole; Custom… writes
 *  nothing by itself — it reveals its field, which writes on Enter or on a
 *  picked suggestion. While Custom… is open the other cards keep their names
 *  only, so the row stays short.
 *
 *  The field: the menu opens from the chevron inside its right edge, or by
 *  typing (which filters it) or ↓. ↑/↓ move, Enter picks the row in view — or,
 *  with no row in view, writes the text — and a click picks a row. The field
 *  never refuses what it is given. Escape closes the menu and puts the stored
 *  profile back; so does leaving the field, so a half-typed profile is never
 *  written. The menu is portalled over the cards, in the shared popover
 *  scaffold (`useAnchoredPopover`, `surface()`); Settings counts a click
 *  inside it as inside itself. */

import {
  AGENTS_UNRESOLVED_MEANS,
  type AgentProfileCard,
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

/** A card's own test attribute value: its profile, or `custom` for the card
 *  that has none. */
function cardKey(card: AgentProfileCard): string {
  return card.profile ?? "custom";
}

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

/** The reference field under an open Custom… card. */
const CustomField: Component<{
  /** The stored profile — the field's text until the user edits it, and again
   *  whenever it changes. */
  profile: string;
  suggestions: readonly ProfileSuggestion[];
  resolved: AgentsResolvedLine | undefined;
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
    <div class="mt-2 flex flex-col gap-1">
      <div ref={field} class="relative min-w-0">
        <input
          ref={input}
          id="agents-profile-input"
          type="text"
          role="combobox"
          aria-expanded={open()}
          aria-controls="agents-profile-options"
          aria-autocomplete="list"
          aria-label="Agents profile reference"
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
        <Show when={props.suggestions.length > 0}>
          <button
            type="button"
            data-testid="agents-profile-chevron"
            aria-label="Show profiles you used before"
            aria-expanded={open()}
            aria-controls="agents-profile-options"
            tabIndex={-1}
            class="absolute inset-y-0 right-0 flex w-8 cursor-pointer items-center justify-center rounded-r-lg text-fg-3 transition-colors hover:text-fg"
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
        </Show>
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
      <Show when={props.resolved}>
        {(line) => (
          <div
            data-testid="agents-resolved"
            data-kind={line().kind}
            class="min-w-0 text-xs leading-relaxed"
          >
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
    </div>
  );
};

const AgentsProfilePicker: Component<{
  cards: readonly AgentProfileCard[];
  /** The card in effect — the setting's, or Custom… once it is picked. */
  selected: AgentProfileCard | undefined;
  /** Pick a card: a profile to write, or `undefined` for Custom… (which
   *  writes nothing until its field does). */
  onPick: (profile: string | undefined) => void;
  /** The stored profile, for Custom…'s field. */
  profile: string;
  suggestions: readonly ProfileSuggestion[];
  /** Whether the stored profile resolves on this machine — shown under
   *  Custom…'s field, so only a reference ever shows it. */
  resolved: AgentsResolvedLine | undefined;
  /** Write `text` as the profile (the caller trims it and drops a no-op). */
  onSubmit: (text: string) => void;
  /** Focus the picked card on mount (the welcome step, while nothing is
   *  chosen, so the keyboard starts on the choice). */
  autofocus?: boolean;
  /** The reference under a card's name — Settings shows it; the welcome step
   *  keeps its cards to names and descriptions. */
  references?: boolean;
}> = (props) => {
  const isSelected = (card: AgentProfileCard) =>
    props.selected !== undefined && cardKey(card) === cardKey(props.selected);
  /** Custom… is open: its field shows, and the other cards keep their names. */
  const customOpen = () => props.selected?.profile === undefined;

  return (
    // Native radios in one `name` group, so ↑/↓/←/→ move between the cards and
    // Tab enters at the picked one — the browser's own radio behaviour, not a
    // key handler of ours. The input is the control; the card is its label.
    <div data-testid="agents-picker" class="mt-2 flex flex-col gap-1.5">
      <For each={props.cards}>
        {(card) => (
          <div
            class="rounded-lg border transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/50"
            classList={{
              "border-accent bg-accent/[0.07]": isSelected(card),
              "border-edge hover:bg-surface-2/60": !isSelected(card),
            }}
          >
            {/* The field below sits OUTSIDE this label: a click in it must
                reach the input it is in, not re-pick the card. */}
            <label class="flex w-full cursor-pointer items-start gap-2.5 px-2.5 py-2 text-left">
              <input
                ref={(el) => {
                  if (props.autofocus && isSelected(card))
                    queueMicrotask(() => el.focus());
                }}
                type="radio"
                name="agents-profile"
                class="sr-only"
                data-testid="agents-profile-card"
                data-profile={cardKey(card)}
                data-selected={isSelected(card) ? "" : undefined}
                checked={isSelected(card)}
                onChange={() => props.onPick(card.profile)}
              />
              <span
                aria-hidden="true"
                class="mt-[3px] grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border-[1.5px]"
                classList={{
                  "border-accent": isSelected(card),
                  "border-edge-bright": !isSelected(card),
                }}
              >
                <Show when={isSelected(card)}>
                  <span class="h-[7px] w-[7px] rounded-full bg-accent" />
                </Show>
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2 text-[13px] font-semibold text-fg">
                  {card.title}
                  <Show when={card.isDefault}>
                    <span class="rounded-full border border-accent/55 px-1.5 text-[10px] font-semibold uppercase leading-4 tracking-wide text-accent">
                      Default
                    </span>
                  </Show>
                </span>
                <Show when={!customOpen() || isSelected(card)}>
                  <span class="mt-px block truncate text-xs text-fg-3">
                    {card.description}
                    <Show when={props.references === true && card.reference}>
                      {(reference) => (
                        <>
                          {" · "}
                          <span class="font-mono">{reference()}</span>
                        </>
                      )}
                    </Show>
                  </span>
                </Show>
              </span>
            </label>
            <Show when={isSelected(card) && card.profile === undefined}>
              <div class="px-2.5 pb-2.5">
                <CustomField
                  profile={props.profile}
                  suggestions={props.suggestions}
                  resolved={props.resolved}
                  onSubmit={props.onSubmit}
                />
              </div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
};

export default AgentsProfilePicker;
