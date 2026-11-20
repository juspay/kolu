import { wrapBracketedPaste } from "@kolu/terminal-protocol";

export const SUBMIT_FLOW_HELP =
  "  kaval-tui send <id> --file brief.md      # 1. the text\n" +
  "  kaval-tui wait <id> --until idle:300     # 2. observe the TUI settle\n" +
  "  kaval-tui send <id> --key Enter          # 3. submit";

export function rejectUnknownSendFlags(
  unknownFlagNames: readonly string[],
): void {
  if (unknownFlagNames.length === 0) return;
  if (unknownFlagNames.includes("submit")) {
    throw new Error(
      "--submit was removed — submitting a prompt is now its OWN command, because a same-breath Enter races the TUI's paste debounce and is silently dropped. Send the text, watch the TUI settle, then submit separately:\n" +
        SUBMIT_FLOW_HELP,
    );
  }
  const names = unknownFlagNames.map((f) => `--${f}`).join(", ");
  throw new Error(
    `unknown flag${unknownFlagNames.length > 1 ? "s" : ""} for send: ${names}. send accepts text (positional) or --file <path>, plus --key, --paste / --no-paste, --json, and --socket / --host.`,
  );
}

export type SendInput =
  | { kind: "positional" }
  | { kind: "file"; path: string }
  | { kind: "stdin" }
  | { kind: "none" };

export function sourceIsStream(input: SendInput): boolean {
  switch (input.kind) {
    case "file":
    case "stdin":
      return true;
    case "positional":
    case "none":
      return false;
  }
}

export function sourceLabel(input: SendInput): string {
  switch (input.kind) {
    case "positional":
      return "positional text";
    case "file":
      return `--file ${JSON.stringify(input.path)}`;
    case "stdin":
      return "piped stdin";
    case "none":
      return "no text source";
  }
}

export function resolveSendInput(opts: {
  hasPositional: boolean;
  file: string | undefined;
  stdinIsPayload: boolean;
  hasKeys: boolean;
  paste: boolean;
  noPaste: boolean;
}): SendInput {
  if (opts.paste && opts.noPaste) {
    throw new Error(
      "--paste and --no-paste are mutually exclusive — pass at most one (omit both for auto).",
    );
  }

  const present: SendInput[] = [];
  if (opts.hasPositional) present.push({ kind: "positional" });
  if (opts.file !== undefined) present.push({ kind: "file", path: opts.file });
  if (opts.stdinIsPayload) present.push({ kind: "stdin" });
  if (present.length > 1) {
    throw new Error(
      `${present.map(sourceLabel).join(" and ")} each provide the send text — pass exactly one source, not several.`,
    );
  }
  const input: SendInput = present[0] ?? { kind: "none" };

  if (input.kind !== "none" && opts.hasKeys) {
    throw new Error(
      "text and --key can't be combined in one send — a same-breath Enter is raced by the TUI's paste debounce and silently dropped. Send the text, watch the TUI settle, then submit as its own command:\n" +
        SUBMIT_FLOW_HELP,
    );
  }

  if (input.kind === "none" && !opts.hasKeys) {
    throw new Error(
      'nothing to send — pass text, use --file <path>, pipe it on stdin, or use --key (e.g. `kaval-tui send <id> "hello"` or `kaval-tui send <id> --key Escape`).',
    );
  }

  return input;
}

export interface SendPlan {
  write: string;
  bytes: number;
  paste: boolean;
}

export type SendContent =
  | {
      kind: "text";
      text: string;
      paste: boolean | undefined;
      fromStream: boolean;
    }
  | { kind: "keys"; keyData: string };

export function planSend(content: SendContent): SendPlan {
  if (content.kind === "keys") {
    return {
      write: content.keyData,
      bytes: Buffer.byteLength(content.keyData, "utf8"),
      paste: false,
    };
  }

  if (content.text.length === 0) {
    throw new Error(
      "planSend: refusing an empty text send — a 0-byte write is a no-op, not a submit.",
    );
  }

  const paste =
    content.paste ?? (content.fromStream || content.text.includes("\n"));

  const write = paste ? wrapBracketedPaste(content.text) : content.text;

  return { write, bytes: Buffer.byteLength(write, "utf8"), paste };
}
