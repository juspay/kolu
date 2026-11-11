/** WHAT THE SETTINGS POPOVER DRAWS, and in what order.
 *
 *  Both decisions here were defects a person met on a live Claude session.
 *  The MODEL row never appeared, although the header was reading its value —
 *  the setting one changes most often was the one setting the panel had no
 *  control for. And `FAST MODE` appeared as a heading with nothing under it,
 *  because a section was drawn out of an option's CHOICES and a boolean has
 *  none. Both are answers about the data rather than about markup, so they
 *  live here where a test can ask them without a DOM.
 *
 *  Order is kolu's one composition in this panel: the agent's own order is
 *  kept, with the model lifted to the front. Nothing else is reordered,
 *  renamed, or filled in — the words stay the adapter's. */

import type { OrchestratorState } from "@kolu/padi-client/orchestrator";

/** One adapter-advertised setting, as the wire sends it. */
export type SettingsOption = OrchestratorState["options"][number];

/** How one option is OPERATED. A select is a list of the agent's rows; a
 *  boolean is one switch on one line. The distinction is the agent's — it
 *  rides on `kind` — not a guess made from how many choices arrived. */
export type SettingsSection =
  | { readonly control: "choices"; readonly option: SettingsOption }
  | {
      readonly control: "switch";
      readonly option: SettingsOption;
      /** The agent's CONFIRMED position, never an assumed default. */
      readonly on: boolean;
    };

/** How a boolean option's two positions are spelled on kolu's wire, which
 *  carries every config value as a string. It is the same spelling the
 *  harness reads a boolean `currentValue` out as, so a value written here
 *  comes back from the agent recognisable as the position it set. */
const ON = "true";
const OFF = "false";

/** The value to send for a switch moved to `on`. */
export const switchValue = (on: boolean): string => (on ? ON : OFF);

/**
 * The sections to draw, in order: the model first, then the agent's own order.
 *
 * Two kinds of row are DROPPED rather than drawn empty, and for the same
 * reason — a heading with no control under it reads as a broken panel:
 *
 *   - a select whose choices did not survive the read. There is nothing to
 *     pick, and the heading alone would say the setting exists and then
 *     refuse to be touched.
 *   - a boolean the agent never stated a value for. ACP requires a boolean
 *     option to carry its `currentValue`, so this is an adapter that broke
 *     its own contract; a switch has to be drawn somewhere, and drawing it
 *     off would be the panel asserting a setting nobody confirmed. A select
 *     with no confirmed value is different and still drawn: it highlights no
 *     row, which claims nothing, and its choices are still real.
 */
export function settingsSections(
  options: ReadonlyArray<SettingsOption>,
): ReadonlyArray<SettingsSection> {
  const models: Array<SettingsSection> = [];
  const rest: Array<SettingsSection> = [];
  for (const option of options) {
    if (option.kind === "boolean") {
      if (option.value === null) continue;
      rest.push({ control: "switch", option, on: option.value === ON });
      continue;
    }
    if (option.choices.length === 0) continue;
    (option.kind === "model" ? models : rest).push({
      control: "choices",
      option,
    });
  }
  return [...models, ...rest];
}
