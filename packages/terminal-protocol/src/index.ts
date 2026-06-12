/**
 * `@kolu/terminal-protocol` — the one home for kolu's VT/device-query policy:
 * everything that must stay in lockstep when "how kolu's terminals speak the
 * wire protocol" changes, pulled out of the packages that merely *apply* it.
 *
 * Owns (one module per concern):
 *  - `responseFilter`  — the query-reply grammars + the two client-side
 *    suppression entry points (whole-payload predicate for xterm `onData`;
 *    streaming boundary-aware stripper for a raw tty).
 *  - `headlessReplies` — the server-side forward/drop policy for replies the
 *    headless mirror generates.
 *  - `deviceQueries`   — the answered/silent matrix as data; executed against
 *    a real headless by `kaval`'s device-query contract tests.
 *  - `bracketedPaste`  — the `?2004` paste delimiters.
 *  - `snapshotReset`   — the reciprocal reset for modes a replayed
 *    `@xterm/addon-serialize` snapshot can switch on.
 *
 * A leaf: zero runtime dependencies, importable from the browser bundle, the
 * pty-host, and the CLI alike — which is exactly why this lives in its own
 * package: the browser may not depend on `kaval`, yet both must
 * agree on every table in here. The constants/tables are plain strings (byte
 * consumers convert at their own boundary); the one byte-level member is the
 * streaming stripper (`Buffer` in, types-only `@types/node` dep) — its
 * consumers are Node-side, and `sideEffects: false` tree-shakes it out of
 * the browser bundle, which imports only the whole-payload predicate.
 */
export {
  BRACKETED_PASTE_END,
  BRACKETED_PASTE_START,
} from "./bracketedPaste.ts";
export {
  ANSWERED_DEVICE_QUERIES,
  type DeviceQueryProbe,
  SILENT_DEVICE_QUERIES,
} from "./deviceQueries.ts";
export { shouldForwardHeadlessReply } from "./headlessReplies.ts";
export {
  createTerminalResponseStripper,
  isTerminalQueryResponse,
  type TerminalResponseStripper,
} from "./responseFilter.ts";
export { SNAPSHOT_TTY_RESET } from "./snapshotReset.ts";
