/** `kaval-tui <verb> <id> [--socket <path>]` for one terminal — the one place
 *  the socket-pinning rule lives, shared by both verbs and the attach section's
 *  main/split rows. The command is built from argv and joined through the
 *  canonical `@kolu/shell-quote`, so a socket path carrying spaces or shell
 *  metacharacters (`/tmp/my sock/pty-host.sock`, an override path) is quoted as
 *  one token instead of re-splitting — or worse, triggering expansion — when the
 *  copied command is pasted back into a shell. This matches what `kaval-tui`
 *  itself prints for its attach hint.
 *
 *  Pure (socket passed in, not read from the global daemon-status signal) so the
 *  quoting contract is unit-testable and this module pulls in no Solid runtime;
 *  the component resolves the live socket once and threads it through. `socket`
 *  undefined → bare command (auto-discovery covers the gap before the daemon
 *  status has loaded). */

import { shellJoin } from "@kolu/shell-quote";

export const kavalCmd = (
  verb: "attach" | "snapshot",
  id: string,
  socket: string | undefined,
): string =>
  shellJoin(["kaval-tui", verb, id, ...(socket ? ["--socket", socket] : [])]);
