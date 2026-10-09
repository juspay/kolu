/** The Agents control's Custom field: a profile REFERENCE of the user's own — a
 *  flake reference or a path to a directory with an `agent-distro.nix`. Enter
 *  (or Use) writes it through the caller; input that is empty or not a
 *  reference is refused inline (`profileReferenceProblem`), never written.
 *  It starts from the stored reference, so editing one is the same field. */

import { type Component, createSignal, Show } from "solid-js";
import {
  AGENTS_CUSTOM_MEANS,
  profileReferenceProblem,
} from "@kolu/agent-distro/status";

const ProfileReferenceField: Component<{
  /** The stored reference, or `""` when the setting names none. */
  initial: string;
  /** Write `reference` (trimmed, already checked). */
  onSubmit: (reference: string) => void;
  /** Focus the field on mount — it appears because Custom was just picked. */
  autofocus?: boolean;
}> = (props) => {
  // Seeded once: the field is the user's draft from here on.
  const [draft, setDraft] = createSignal(props.initial);
  const [problem, setProblem] = createSignal<string | undefined>();
  const submit = () => {
    const why = profileReferenceProblem(draft());
    setProblem(why);
    if (why === undefined) props.onSubmit(draft().trim());
  };
  return (
    <div class="mt-1.5 flex w-full min-w-64 flex-col gap-1">
      <div class="flex items-center gap-1.5">
        <input
          ref={(el) => {
            if (props.autofocus) queueMicrotask(() => el.focus());
          }}
          type="text"
          spellcheck={false}
          autocomplete="off"
          data-testid="agents-reference-input"
          class="h-8 min-w-0 flex-1 rounded-lg border border-edge bg-surface-1 px-2.5 font-mono text-xs text-fg placeholder:text-fg-3 transition-colors focus:border-accent/50 focus:bg-surface-2 focus:outline-none"
          classList={{ "border-danger/60": problem() !== undefined }}
          placeholder="github:owner/repo or ~/my-profile"
          aria-label="Profile reference"
          aria-invalid={problem() !== undefined}
          title={AGENTS_CUSTOM_MEANS}
          value={draft()}
          onInput={(e) => {
            setDraft(e.currentTarget.value);
            setProblem(undefined);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
        />
        <button
          type="button"
          data-testid="agents-reference-use"
          class="h-8 shrink-0 rounded-lg border border-edge px-2.5 text-xs text-fg-2 transition-colors hover:bg-surface-2 hover:text-fg cursor-pointer"
          onClick={submit}
        >
          Use
        </button>
      </div>
      <Show when={problem()}>
        {(why) => (
          <p
            data-testid="agents-reference-problem"
            class="text-[11px] leading-4 text-danger"
          >
            {why()}
          </p>
        )}
      </Show>
    </div>
  );
};

export default ProfileReferenceField;
