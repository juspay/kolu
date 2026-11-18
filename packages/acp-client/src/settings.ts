/** Preserve the agent's ordering and vocabulary; normalize only control shapes. */
import type { SessionConfigOption } from "@agentclientprotocol/sdk";
import type { SessionSetting } from "./shapes.ts";

export const settingsIn = (
  options: ReadonlyArray<SessionConfigOption> | null | undefined,
): ReadonlyArray<SessionSetting> =>
  (options ?? []).flatMap((option): SessionSetting[] => {
    const common = {
      id: option.id,
      name: option.name,
      description: option.description ?? "",
    };
    if (option.type === "boolean")
      return [
        { ...common, type: "boolean", currentValue: option.currentValue },
      ];
    if (option.type !== "select") return [];
    return [
      {
        ...common,
        type: "select",
        currentValue: option.currentValue,
        options: option.options
          .flatMap((row) => ("value" in row ? [row] : row.options))
          .map((row) => ({
            value: row.value,
            name: row.name,
            description: row.description ?? "",
          })),
      },
    ];
  });

export const acceptsSetting = (
  setting: SessionSetting,
  value: string | boolean,
): boolean =>
  setting.type === "boolean"
    ? typeof value === "boolean"
    : typeof value === "string" &&
      setting.options.some((option) => option.value === value);
