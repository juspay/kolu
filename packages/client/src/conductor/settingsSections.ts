import type { ConductorState } from "kolu-common/conductor";

export type SettingsOption = ConductorState["options"][number];

export type SettingsSection =
  | { readonly control: "choices"; readonly option: SettingsOption }
  | {
      readonly control: "switch";
      readonly option: SettingsOption;
      readonly on: boolean;
    };

const ON = "true";
const OFF = "false";

export const switchValue = (on: boolean): string => (on ? ON : OFF);

function drawableSection(option: SettingsOption): SettingsSection | null {
  if (option.kind === "boolean") {
    if (option.value === null) return null;
    return { control: "switch", option, on: option.value === ON };
  }
  if (option.choices.length === 0) return null;
  return { control: "choices", option };
}

export function settingsSections(
  options: ReadonlyArray<SettingsOption>,
): ReadonlyArray<SettingsSection> {
  const models: Array<SettingsSection> = [];
  const rest: Array<SettingsSection> = [];
  for (const option of options) {
    const section = drawableSection(option);
    if (section === null) continue;
    (option.kind === "model" ? models : rest).push(section);
  }
  return [...models, ...rest];
}
