/** `kaval-tui <verb> <id> [--socket <path>]` for one terminal — the one place
 *  the socket-pinning rule lives, shared by every id-targeted verb (attach,
 *  snapshot, send) the attach section's main/split rows offer. The command is
 *  built from argv and joined through the
 *  canonical `@kolu/shell-quote`, so a socket path carrying spaces or shell
 *  metacharacters (`/tmp/my sock/pty-host.sock`, an override path) is quoted as
 *  one token instead of re-splitting — or worse, triggering expansion — when the
 *  copied command is pasted back into a shell. This matches what `kaval-tui`
 *  itself prints for its attach hint.
 *
 *  `send` carries a `<prompt>` placeholder where the text you type goes —
 *  `send` writes EXACTLY what it's handed and refuses an empty payload
 *  (`nothing to send`), so unlike attach/snapshot the copied line is a template
 *  to complete, not a command to run verbatim. The placeholder lands quoted
 *  (`'<prompt>'`) because `<`/`>` aren't bare-word safe, which doubles as a
 *  visual "fill this in" cue.
 *
 *  Pure (socket passed in, not read from the global daemon-status signal) so the
 *  quoting contract is unit-testable and this module pulls in no Solid runtime;
 *  the component resolves the live socket once and threads it through. `socket`
 *  undefined → bare command (auto-discovery covers the gap before the daemon
 *  status has loaded). */

import { shellJoin } from "@kolu/shell-quote";

export const kavalCmd = (
  verb: "attach" | "snapshot" | "send",
  id: string,
  socket: string | undefined,
): string =>
  shellJoin([
    "kaval-tui",
    verb,
    id,
    // The prompt sits right after the id (before --socket) so it stays visible
    // when a long socket path truncates off the button's end.
    ...(verb === "send" ? ["<prompt>"] : []),
    ...(socket ? ["--socket", socket] : []),
  ]);

/** The `--socket <path>` flag as one shell-ready string — the standalone socket
 *  affordance copies THIS (not the bare path) so a paste appends cleanly to a
 *  reference command (`kaval-tui list <paste>`), with the path quoted exactly as
 *  the id-targeted commands quote it. Lives here so the socket-quoting rule stays
 *  in the one module that owns it. */
export const kavalSocketArg = (socket: string): string =>
  shellJoin(["--socket", socket]);
