/** The Agents row's profile field: one text input with suggestions
 *  (`profileSuggestions` — Juspay's profile, every bundle kolu ships, then what
 *  was set before), and the lines under it — whether agent-distro resolves the
 *  profile on this machine (`agentsResolvedLine`: pending, resolved, or its own
 *  words, red, when it does not), then the agents with their versions and that
 *  a repository's own `agent-distro.nix` overrides it (`agentsProfileNotes`).
 *  Enter, or picking a suggestion, hands the text to the caller, which writes
 *  it whole; the field never refuses what it is given. Leaving the field
 *  (blur) or Escape puts the stored profile back, so a half-typed profile is
 *  never written. */

import type {
  AgentsResolvedLine,
  ProfileSuggestion,
} from "@kolu/agent-distro/status";
import {
  type Component,
  createEffect,
  createSignal,
  For,
  on,
  Show,
} from "solid-js";

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
  return (
    <div class="mt-2 flex flex-col gap-1" data-testid="agents-profile">
      <div class="flex items-center gap-2.5">
        <label
          for="agents-profile-input"
          class="w-14 shrink-0 text-xs font-medium text-fg-2"
        >
          Profile
        </label>
        <input
          id="agents-profile-input"
          type="text"
          list="agents-profile-suggestions"
          spellcheck={false}
          autocomplete="off"
          data-testid="agents-profile-input"
          class="h-8 min-w-0 flex-1 rounded-lg border border-edge bg-surface-1 px-2.5 font-mono text-xs text-fg placeholder:text-fg-3 transition-colors focus:border-accent/50 focus:bg-surface-2 focus:outline-none"
          classList={{ "border-danger/60": props.resolved?.kind === "failed" }}
          placeholder="github:owner/repo or ~/my-profile"
          value={draft()}
          onInput={(e) => {
            setDraft(e.currentTarget.value);
            // A suggestion picked from the list replaces the text whole
            // (Chromium and WebKit: `insertReplacementText`; Firefox: a plain
            // Event) — a choice, so it writes, as Enter does. Typing never
            // lands here as either.
            if (
              !(e instanceof InputEvent) ||
              e.inputType === "insertReplacementText"
            )
              props.onSubmit(e.currentTarget.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") props.onSubmit(draft());
            if (e.key === "Escape") setDraft(props.profile);
          }}
          onBlur={() => setDraft(props.profile)}
        />
        <datalist id="agents-profile-suggestions">
          <For each={props.suggestions}>
            {(s) => <option value={s.value} label={s.note} />}
          </For>
        </datalist>
      </div>
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
              <Show
                when={(() => {
                  const l = line();
                  return l.kind === "failed" ? l.detail : undefined;
                })()}
              >
                {(detail) => <p class="text-fg-3/70">{detail()}</p>}
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
