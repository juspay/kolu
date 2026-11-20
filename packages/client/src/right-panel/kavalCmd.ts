import { shellJoin } from "@kolu/shell-quote";

const PROMPT_PLACEHOLDER = "<prompt>";

export const kavalCmd = (
  verb: "attach" | "snapshot" | "send",
  id: string,
  socket: string | undefined,
): string =>
  shellJoin([
    "kaval-tui",
    verb,
    id,
    ...(verb === "send" ? [PROMPT_PLACEHOLDER] : []),
    ...(socket ? ["--socket", socket] : []),
  ]);

export const kavalSocketArg = (socket: string): string =>
  shellJoin(["--socket", socket]);
