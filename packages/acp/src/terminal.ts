/** The terminal-output extension used by Codex and pi. It is opt-in per leg;
 * these metadata fields describe output, never permission or tool identity. */
export type TerminalUpdate =
  | { readonly kind: "begin"; readonly id: string }
  | { readonly kind: "output"; readonly id: string; readonly data: string }
  | {
      readonly kind: "exit";
      readonly id: string;
      readonly code: number | null;
      readonly signal: string | null;
    };

const object = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

export const terminalMetaIn = (
  value: unknown,
): ReadonlyArray<TerminalUpdate> => {
  const meta = object(value);
  if (meta === null) return [];
  const updates: TerminalUpdate[] = [];
  const info = object(meta.terminal_info);
  if (typeof info?.terminal_id === "string")
    updates.push({ kind: "begin", id: info.terminal_id });
  const output =
    object(meta.terminal_output) ?? object(meta.terminal_output_delta);
  if (
    typeof output?.terminal_id === "string" &&
    typeof output.data === "string"
  ) {
    updates.push({ kind: "output", id: output.terminal_id, data: output.data });
  }
  const exit = object(meta.terminal_exit);
  if (typeof exit?.terminal_id === "string")
    updates.push({
      kind: "exit",
      id: exit.terminal_id,
      code: typeof exit.exit_code === "number" ? exit.exit_code : null,
      signal: typeof exit.signal === "string" ? exit.signal : null,
    });
  return updates;
};
