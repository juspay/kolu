import {
  AGENTS_UNRESOLVED_MEANS,
  type AgentsResolvedLine,
  JUSPAY_OFFER,
  type ProfileSuggestion,
  profilesWithAdded,
  profilesWithMoved,
  profilesWithRemoved,
} from "@kolu/agent-distro/status";
import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
} from "solid-js";
import { Portal } from "solid-js/web";
import DocLink from "../ui/DocLink";
import { ChevronDownIcon, ChevronUpIcon, CloseIcon } from "../ui/Icons";
import { surface } from "../ui/Surface";
import { useAnchoredPopover } from "../ui/useAnchoredPopover";
import FailureWords from "./FailureWords";

export const AGENTS_PROFILE_MENU_TESTID = "agents-profile-menu";

export interface ProfileListRow {
  readonly reference: string;
  readonly title: string;
  readonly line?: AgentsResolvedLine;
}

function matching(
  suggestions: readonly ProfileSuggestion[],
  text: string,
): readonly ProfileSuggestion[] {
  const needle = text.trim().toLowerCase();
  return suggestions.filter(
    (s) =>
      s.value.toLowerCase().includes(needle) ||
      (s.title ?? "").toLowerCase().includes(needle) ||
      s.note.toLowerCase().includes(needle),
  );
}

const AddField: Component<{
  suggestions: readonly ProfileSuggestion[];
  onAdd: (text: string) => void;
}> = (props) => {
  const [draft, setDraft] = createSignal("");
  const [open, setOpen] = createSignal(false);
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
  const add = (value: string) => {
    close();
    setDraft("");
    props.onAdd(value);
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
    flip: true,
  });
  const chrome = surface({ radius: "lg", shadow: "light", portalled: true });

  return (
    <div ref={field} class="relative min-w-0">
      <input
        ref={input}
        id="agents-profile-input"
        type="text"
        role="combobox"
        aria-expanded={open()}
        aria-controls="agents-profile-options"
        aria-autocomplete="list"
        aria-label="Add a profile — a flake reference or a path"
        aria-activedescendant={
          active() === undefined
            ? undefined
            : `agents-profile-option-${active()}`
        }
        spellcheck={false}
        autocomplete="off"
        data-testid="agents-profile-input"
        class="h-8 w-full rounded-lg border border-edge bg-surface-1 pl-2.5 pr-8 font-mono text-xs text-fg placeholder:text-fg-3 transition-colors focus:border-accent/50 focus:bg-surface-2 focus:outline-none"
        placeholder="Add github:owner/repo or ~/my-profile"
        value={draft()}
        onInput={(e) => {
          setDraft(e.currentTarget.value);
          show(true);
        }}
        on:keydown={(e) => {
          switch (e.key) {
            case "ArrowDown":
            case "ArrowUp":
              e.preventDefault();
              if (!open()) show(false);
              move(e.key === "ArrowDown" ? 1 : -1);
              return;
            case "Enter": {
              e.preventDefault();
              const at = active();
              const row = at === undefined ? undefined : rows()[at];
              add(open() && row !== undefined ? row.value : draft());
              return;
            }
            case "Escape":
              if (open()) {
                e.stopPropagation();
                close();
              } else if (draft() !== "") {
                e.stopPropagation();
                setDraft("");
              }
              return;
          }
        }}
        onFocus={() => show(false)}
        onBlur={close}
      />
      <Show when={props.suggestions.length > 0}>
        <button
          type="button"
          data-testid="agents-profile-chevron"
          aria-label="Show suggested profiles"
          aria-expanded={open()}
          aria-controls="agents-profile-options"
          tabIndex={-1}
          class="absolute inset-y-0 right-0 flex w-8 cursor-pointer items-center justify-center rounded-r-lg text-fg-3 transition-colors hover:text-fg"
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
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i())}
                  onClick={() => add(row.value)}
                >
                  <Show
                    when={row.title}
                    fallback={
                      <span class="shrink-0 font-mono">{row.value}</span>
                    }
                  >
                    {(title) => (
                      <span class="shrink-0 font-semibold text-fg">
                        + {title()}
                      </span>
                    )}
                  </Show>
                  <span class="min-w-0 truncate text-fg-3/70">{row.note}</span>
                </button>
              )}
            </For>
          </div>
        </Portal>
      </Show>
    </div>
  );
};

const ResolvedLine: Component<{ line: AgentsResolvedLine }> = (props) => (
  <div
    data-testid="agents-resolved"
    data-kind={props.line.kind}
    class="min-w-0 text-xs leading-relaxed"
  >
    {/* A resolved line is one line (a name and a description); a failure's
        words wrap in FULL with Nix's output under them — a cut-off cause is
        no cause (the host details' rule, and component, for the same words). */}
    <Show
      when={props.line.kind === "failed" ? props.line : undefined}
      fallback={
        <p
          title={props.line.text}
          class="truncate"
          classList={{
            "text-fg-3/70 italic": props.line.kind === "pending",
            "text-fg-3": props.line.kind === "resolved",
          }}
        >
          {props.line.text}
        </p>
      }
    >
      {(failed) => (
        <>
          <FailureWords
            words={{ headline: failed().text, detail: failed().detail }}
            tone="danger"
            testid="agents-resolved-failure"
          />
          <p class="text-fg-3/70">{AGENTS_UNRESOLVED_MEANS}</p>
        </>
      )}
    </Show>
  </div>
);

const ROW_BUTTON =
  "grid h-6 w-6 shrink-0 cursor-pointer place-items-center rounded-md text-fg-3 transition-colors hover:bg-surface-3 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg-3";

type RowAction = "up" | "down" | "remove";

function restoreRowFocus(
  list: HTMLOListElement,
  target: { readonly reference: string; readonly action: RowAction },
): void {
  const row = [
    ...list.querySelectorAll<HTMLElement>("[data-testid=agents-profile-row]"),
  ].find((el) => el.dataset.reference === target.reference);
  const buttons = row
    ? [...row.querySelectorAll<HTMLButtonElement>("button[data-action]")]
    : [];
  const button =
    buttons.find((b) => b.dataset.action === target.action && !b.disabled) ??
    buttons.find((b) => !b.disabled);
  button?.focus();
}

const AgentsProfileList: Component<{
  rows: readonly ProfileListRow[];
  suggestions: readonly ProfileSuggestion[];
  prominentJuspay?: boolean;
  onChange: (next: readonly string[]) => void;
}> = (props) => {
  const references = createMemo(() => props.rows.map((r) => r.reference));
  const rowOf = createMemo(
    () => new Map(props.rows.map((r) => [r.reference, r])),
  );
  let list: HTMLOListElement | undefined;

  const [refocus, setRefocus] = createSignal<
    | {
        readonly reference: string;
        readonly action: RowAction;
        readonly before: string;
      }
    | undefined
  >();
  createEffect(() => {
    const target = refocus();
    const now = JSON.stringify(references());
    if (target === undefined || list === undefined || now === target.before)
      return;
    restoreRowFocus(list, target);
    setRefocus(undefined);
  });

  const edit = (
    next: readonly string[],
    focus?: { readonly reference: string; readonly action: RowAction },
  ) => {
    setRefocus(
      focus === undefined
        ? undefined
        : { ...focus, before: JSON.stringify(references()) },
    );
    props.onChange(next);
  };
  const move = (index: number, step: 1 | -1) => {
    const reference = references()[index];
    if (reference === undefined) return;
    edit(profilesWithMoved(references(), index, index + step), {
      reference,
      action: step === -1 ? "up" : "down",
    });
  };
  const remove = (index: number) => {
    const refs = references();
    const neighbour = refs[index + 1] ?? refs[index - 1];
    edit(
      profilesWithRemoved(refs, index),
      neighbour === undefined
        ? undefined
        : { reference: neighbour, action: "remove" },
    );
  };
  const add = (text: string) => {
    const next = profilesWithAdded(references(), text);
    if (next !== undefined) edit(next);
  };

  return (
    <div data-testid="agents-profiles" class="mt-2 flex flex-col gap-1.5">
      <Show
        when={
          props.prominentJuspay === true &&
          !references().includes(JUSPAY_OFFER.reference)
        }
      >
        <button
          type="button"
          data-testid="agents-add-juspay"
          class="flex w-full cursor-pointer items-baseline gap-2 rounded-lg border border-accent/40 bg-accent/10 px-2.5 py-2 text-left text-xs transition-colors hover:border-accent/70 hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          onClick={() => add(JUSPAY_OFFER.reference)}
        >
          <span class="shrink-0 text-[13px] font-semibold text-accent">
            + {JUSPAY_OFFER.title}
          </span>
          <span class="min-w-0 truncate text-fg-2">
            {JUSPAY_OFFER.description}
          </span>
        </button>
      </Show>
      <ol
        ref={list}
        aria-label="Profiles, stacked in this order"
        class="flex flex-col divide-y divide-edge/60 rounded-lg border border-edge"
      >
        {/* Keyed on the reference: a moved row keeps its node. */}
        <For each={references()}>
          {(reference, i) => {
            const row = () => rowOf().get(reference);
            const title = () => row()?.title ?? reference;
            return (
              <li
                data-testid="agents-profile-row"
                data-reference={reference}
                class="flex items-start gap-2 px-2.5 py-2"
              >
                <span class="mt-px w-4 shrink-0 text-right text-xs tabular-nums text-fg-3/70">
                  {i() + 1}
                </span>
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 items-baseline gap-2">
                    <span class="shrink-0 text-[13px] font-semibold text-fg">
                      {title()}
                    </span>
                    <Show when={title() !== reference}>
                      <span class="min-w-0 truncate font-mono text-xs text-fg-3">
                        {reference}
                      </span>
                    </Show>
                  </div>
                  <Show when={row()?.line}>
                    {(line) => <ResolvedLine line={line()} />}
                  </Show>
                </div>
                <div class="flex shrink-0 items-center gap-0.5">
                  {/* Order means something only with two rows or more. */}
                  <Show when={references().length > 1}>
                    <button
                      type="button"
                      data-action="up"
                      data-testid="agents-profile-up"
                      aria-label={`Move ${title()} up`}
                      title="Move up"
                      class={ROW_BUTTON}
                      disabled={i() === 0}
                      onClick={() => move(i(), -1)}
                    >
                      <ChevronUpIcon class="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      data-action="down"
                      data-testid="agents-profile-down"
                      aria-label={`Move ${title()} down`}
                      title="Move down"
                      class={ROW_BUTTON}
                      disabled={i() === references().length - 1}
                      onClick={() => move(i(), 1)}
                    >
                      <ChevronDownIcon class="h-3.5 w-3.5" />
                    </button>
                  </Show>
                  <button
                    type="button"
                    data-action="remove"
                    data-testid="agents-profile-remove"
                    aria-label={`Remove ${title()}`}
                    title="Remove"
                    class={ROW_BUTTON}
                    onClick={() => remove(i())}
                  >
                    <CloseIcon class="h-3 w-3" />
                  </button>
                </div>
              </li>
            );
          }}
        </For>
        {/* Not an entry of the setting: it cannot be moved or removed. */}
        <li
          data-testid="agents-profile-repo"
          class="flex items-start gap-2 bg-surface-2/40 px-2.5 py-2"
        >
          <span class="mt-px w-4 shrink-0" aria-hidden="true" />
          <div class="min-w-0 flex-1 text-xs leading-relaxed text-fg-3">
            A repository's own{" "}
            <span class="font-mono text-fg-2">plugin.json</span> composes over
            everything above it.{" "}
            <DocLink slug="agents" anchor="how-profiles-stack">
              How profiles stack →
            </DocLink>
          </div>
        </li>
      </ol>
      <AddField
        suggestions={
          props.prominentJuspay === true
            ? props.suggestions.filter(
                (s) => s.value !== JUSPAY_OFFER.reference,
              )
            : props.suggestions
        }
        onAdd={add}
      />
    </div>
  );
};

export default AgentsProfileList;
