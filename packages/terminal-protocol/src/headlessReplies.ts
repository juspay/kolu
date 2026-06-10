/**
 * Forward/drop policy for the replies the HEADLESS terminal generates — the
 * server half of the device-query protocol (the client half is
 * `responseFilter.ts`'s suppression of the mirroring clients' duplicates).
 *
 * The headless xterm answers device queries on behalf of a possibly-absent
 * client (DA1/DA2, DSR/CPR, DECRPM, DECRQSS natively; XTVERSION via the
 * pty-host's hand-rolled handler). Those CSI/DCS answers must reach the PTY
 * child — TUIs block on them. OSC replies must NOT: no headless OSC answer
 * exists that a program consumes (the headless has no theme, no clipboard),
 * and an OSC packet echoed by a cooked tty prints as visible garbage. The
 * full answered/silent matrix lives in `deviceQueries.ts` and is pinned
 * against a real headless in `@kolu/pty-host`'s device-query contract tests.
 */
export function shouldForwardHeadlessReply(reply: string): boolean {
  return !reply.startsWith("\x1b]");
}
