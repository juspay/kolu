/** What a `tool` row DRAWS — the two derivations a card cannot read straight
 *  off the row, and the clock under its trailing `· 47s`.
 *
 *  There is no row→card projection here, and its absence is the point:
 *  `row.kolu.kind` IS the card's vocabulary. The one collapsing that had to
 *  happen — three ways of waiting drawn as one `settle` — was paid for in the
 *  harness before the row left the host, so a second table in the browser
 *  spelling the same arms back was a table to keep in step for nothing.
 *
 *  Which rows get a kolu-aware card is the harness's decision too: a call it
 *  positively recognised as the `kolu` MCP server's carries a structured
 *  `kolu` reading and can name the terminal and open it; every other call
 *  carries none and gets the generic card built from the agent's own title and
 *  the folded JSON it sent. A tool nobody could name is the direction this is
 *  safe to fail in — a generic card is honest, an invented reading is not. */

import type {
  ConductorKoluCall,
  ConductorToolRow,
} from "kolu-common/conductor";
// `formatElapsedShort`, not the vocabulary's `dualPhrase`: the ladder's minute
// tier has no finer unit, so a 2m14s wait would read "2m" — and the number a
// reader is checking against a timeout is exactly the one that would be gone.
import { formatElapsedShort } from "../time/duration";

/** What went in: typed text, or one named key. Exactly one, as the tool itself
 *  requires — a call carrying neither is drawn as the bare arrow. */
export function sentInput(
  call: Extract<ConductorKoluCall, { kind: "sendInput" }>,
): { readonly as: "text" | "key"; readonly value: string } | null {
  if (call.text !== null) return { as: "text", value: call.text };
  if (call.key !== null) return { as: "key", value: call.key };
  return null;
}

/** The wait, already phrased (`2m 14s`). `null` when the tool reported no
 *  elapsed — a wait with no duration is not a wait of zero. */
export function waitedFor(elapsedMs: number | null): string | null {
  return elapsedMs === null ? null : formatElapsedShort(elapsedMs);
}

/** How long a call has been running, as the card's trailing `· 47s`.
 *
 *  Two refusals, both deliberate. A call that is not RUNNING has no clock: a
 *  finished call's duration is a different fact and the card does not claim it.
 *  And a clock only appears once the wait is long enough to be worth watching —
 *  a stopwatch on every sub-second call is noise that makes the one call
 *  actually taking a minute harder to spot. `startedAt` is the writer's stamp,
 *  so a reloaded tab and the tab beside it agree on the number. */
const CLOCK_AFTER_MS = 3_000;

export function runningFor(
  row: Pick<ConductorToolRow, "status" | "startedAt">,
  now: number,
): string | null {
  if (row.status !== "in_progress" || row.startedAt === undefined) return null;
  const started = Date.parse(row.startedAt);
  if (Number.isNaN(started)) return null;
  const elapsed = now - started;
  if (elapsed < CLOCK_AFTER_MS) return null;
  return formatElapsedShort(elapsed);
}
