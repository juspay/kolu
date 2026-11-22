/** The Settings row for where the Conductor compacts its conversation —
 *  `200k`, `Model limit`, or a number typed in thousands. Its own file, as the
 *  Agents section is: it keeps its own state (the custom field), and it moves
 *  with the Conductor's compaction choices rather than with the popover. */

import {
  CONDUCTOR_COMPACTS_AT_DEFAULT,
  CONDUCTOR_COMPACTS_AT_MAX,
  CONDUCTOR_COMPACTS_AT_MIN,
  CONDUCTOR_MODEL_LIMIT,
} from "kolu-common/surface";
import { type Component, createSignal, Show } from "solid-js";
import { tokens } from "../conductor/tokens";
import SegmentedControl, {
  type SegmentedControlOption,
} from "../ui/SegmentedControl";
import { preferences, updatePreferences } from "../wire";
import { compactsAtEntry } from "./compactsAtEntry";
import SettingRow, { type Hint } from "./SettingRow";

/** Where the Conductor compacts, as the row offers it: the default, Model
 *  limit, or a number the person types. Keyed by words, so a segment's
 *  identity is not a count that a different default would move. */
type CompactsAtChoice = "default" | "model-limit" | "custom";

const COMPACTS_AT_CHOICES: readonly SegmentedControlOption<CompactsAtChoice>[] =
  [
    { value: "default", label: tokens(CONDUCTOR_COMPACTS_AT_DEFAULT) },
    { value: "model-limit", label: "Model limit" },
    { value: "custom", label: "Custom" },
  ];

const COMPACTS_AT_HINT = {
  number: {
    text: "Past this many tokens the older part of the Conductor's conversation is replaced with a summary. Applies the next time kolu starts.",
  },
  modelLimit: {
    text: "kolu sends no compaction setting. Your own Claude Code settings decide when the Conductor's conversation is compacted, and whether it is at all. A long conversation is slower and costs more. Applies the next time kolu starts.",
    tone: "warn",
  },
  refused: {
    text: `Type a whole number from ${CONDUCTOR_COMPACTS_AT_MIN / 1000} to ${CONDUCTOR_COMPACTS_AT_MAX / 1000}, in thousands of tokens. Nothing was saved.`,
    tone: "warn",
  },
} satisfies Record<string, Hint>;

/** The Conductor's compaction point. `200k` and `Model limit` save at once;
 *  `Custom` saves nothing and opens a field in thousands of tokens, which saves
 *  a valid entry on Enter or on leaving it. Rendered inside the open popover,
 *  so the field's state starts shut each time Settings opens. */
const CompactsAtRow: Component = () => {
  /** The custom field — shut, open, or open after an entry it refused. The
   *  row's only local state: what is saved is read off the preference. */
  const [field, setField] = createSignal<"shut" | "open" | "refused">("shut");
  const stored = () => preferences().conductorCompactsAt;
  const pressed = (): CompactsAtChoice => {
    const at = stored();
    if (field() !== "shut") return "custom";
    if (at === CONDUCTOR_MODEL_LIMIT) return "model-limit";
    return at === CONDUCTOR_COMPACTS_AT_DEFAULT ? "default" : "custom";
  };
  const storedThousands = (): string => {
    const at = stored();
    return at === CONDUCTOR_MODEL_LIMIT ? "" : String(at / 1000);
  };
  const pick = (choice: CompactsAtChoice): void => {
    if (choice === "custom") {
      setField("open");
      return;
    }
    setField("shut");
    updatePreferences({
      conductorCompactsAt:
        choice === "default"
          ? CONDUCTOR_COMPACTS_AT_DEFAULT
          : CONDUCTOR_MODEL_LIMIT,
    });
  };
  const enter = (typed: string): void => {
    const count = compactsAtEntry(typed);
    if (count === null) {
      setField("refused");
      return;
    }
    setField("open");
    if (count !== stored()) updatePreferences({ conductorCompactsAt: count });
  };
  const hint = (): Hint => {
    if (field() === "refused") return COMPACTS_AT_HINT.refused;
    return pressed() === "model-limit"
      ? COMPACTS_AT_HINT.modelLimit
      : COMPACTS_AT_HINT.number;
  };
  return (
    <SettingRow
      label="Conductor compacts at"
      hint={hint()}
      doc="conductor-memory"
    >
      <div class="flex flex-wrap items-center justify-end gap-2">
        <SegmentedControl
          options={COMPACTS_AT_CHOICES}
          value={pressed()}
          onChange={pick}
          testIdPrefix="conductor-compacts-at"
        />
        <Show when={pressed() === "custom"}>
          <label class="flex items-center gap-1 text-xs text-fg-2">
            <input
              type="text"
              inputmode="numeric"
              spellcheck={false}
              autocomplete="off"
              aria-label="Compact the Conductor's conversation at, in thousands of tokens"
              data-testid="conductor-compacts-at-field"
              class="h-7 w-16 rounded-lg border border-edge bg-surface-1 px-2 text-right font-mono text-xs text-fg transition-colors focus:border-accent/50 focus:bg-surface-2 focus:outline-none"
              value={storedThousands()}
              on:keydown={(e) => {
                if (e.key === "Enter") enter(e.currentTarget.value);
              }}
              onBlur={(e) => enter(e.currentTarget.value)}
            />
            k
          </label>
        </Show>
      </div>
    </SettingRow>
  );
};

export default CompactsAtRow;
