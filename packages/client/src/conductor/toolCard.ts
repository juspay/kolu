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
import type { TerminalId } from "kolu-common/surface";

/** The terminal a card is ABOUT, when it is about one — BOTH halves of its
 *  identity. Every kolu reading carries the id and the host it is on (the two
 *  sides of the `host/id` the agent spoke); a call nobody could resolve carries
 *  neither, and has nothing to open, nothing to look at and nothing to guess
 *  at. The card's "open tile" reads it, and so does `agentLineSubject`. */
export function callSubject(
  call: ConductorKoluCall | undefined,
): { readonly host: string; readonly id: TerminalId } | null {
  if (call === undefined || call.terminalId === null || call.host === null) {
    return null;
  }
  return { host: call.host, id: call.terminalId };
}

/** The terminal an AGENT LINE is about — a `create` card that names one. The
 *  card draws its status and Look for it, and the transcript keeps it out of
 *  the fold for the same reason: one question, asked in one place. */
export function agentLineSubject(
  row: ConductorToolRow,
): { readonly host: string; readonly id: TerminalId } | null {
  return row.kolu?.kind === "create" ? callSubject(row.kolu) : null;
}

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

/** The tool's name as a card shows it: the tool, else its server, else the
 *  bare word — the one spelling a card and a failure run share. */
export function toolLabel(row: ConductorToolRow): string {
  return row.tool ?? row.server ?? "tool";
}

/** The brand our own MCP edge stamps on every error it answers a tool call
 *  with (`brand` in `packages/surface-mcp/src/tools.ts`). It says which layer
 *  spoke, not why the call failed, so a reason drops it. Spelled here rather
 *  than imported: the client does not depend on the MCP adapter, and the
 *  claude-code leg reads the same literal off the same answers (`leg.ts`). */
const MCP_BRAND = "surface-mcp: ";

/** A text wrapped in ONE Markdown code fence, unwrapped — the adapter fences
 *  a tool's error text, and the marks are not part of the sentence. Anything
 *  else is returned as it is. */
function unfenced(text: string): string {
  if (text.length < 6 || !text.startsWith("```") || !text.endsWith("```")) {
    return text;
  }
  const body = text.slice(3, -3);
  // An opening fence line may carry an info string (```text); drop that line.
  const lineEnd = body.indexOf("\n");
  return lineEnd === -1 ? body : body.slice(lineEnd + 1);
}

/** Why a FAILED call failed, as the one sentence its card shows — `null` for
 *  a call that did not fail, or failed without saying why.
 *
 *  The tool's own words come back as the call's content (`progress`); a kolu
 *  `screen`/`settle` reading of a failed call holds the same words where a
 *  screen would be, because the harness reads the answer whatever it is — so
 *  that is the fallback, and never drawn as a screen. */
export function failureReason(row: ConductorToolRow): string | null {
  if (row.status !== "failed") return null;
  const call = row.kolu;
  const said =
    row.progress ??
    (call?.kind === "screen"
      ? call.snapshot
      : call?.kind === "settle"
        ? call.screenTail
        : null);
  if (said === null) return null;
  let reason = unfenced(said.trim()).trim();
  if (reason.startsWith(MCP_BRAND)) reason = reason.slice(MCP_BRAND.length);
  reason = reason.trim();
  return reason === "" ? null : reason;
}

/** How deep a payload may nest JSON inside a JSON string before this stops
 *  unwrapping. Two is what the real traffic needs — an MCP answer arrives as a
 *  JSON STRING, which the harness then prints with `JSON.stringify`, so the
 *  text the card holds is a quoted string whose content is a document — and a
 *  bound rather than a `while (true)` because the input is a remote agent's
 *  and a hostile one could nest for as long as it liked. */
const UNWRAP_LIMIT = 2;

/** The folded body, printed rather than dumped.
 *
 *  The harness already prints a call's input and output with
 *  `JSON.stringify(value, null, 2)`, so a STRUCTURED payload arrives here as
 *  readable lines. What it cannot do anything about is a payload whose content
 *  is itself JSON carried as a string: `ListMcpResourcesTool` answers 5 KB of
 *  minified listing as one string value, and stringifying a string gives back
 *  one 5 KB line with its quotes escaped — unreadable, and (before the card
 *  learned to wrap) wide enough to push the document past the window.
 *
 *  So this unwraps that one case and prints it with the SAME formatter the
 *  harness used, two-space indent and all — there is no second notion of what
 *  folded JSON looks like. A block that is not JSON, or whose JSON is a bare
 *  scalar, is handed back untouched: unquoting `"echo hi"` into `echo hi`
 *  would be this function editing a payload rather than printing it. */
export function foldJson(detail: string): string {
  // TWO BLOCKS, not one: the harness joins a call's input and its output with
  // a blank line, and the pair is not itself JSON. An indented
  // `JSON.stringify` never emits a blank line, so that join is the one place
  // this may split without cutting a document in half.
  return detail
    .split("\n\n")
    .map((block) => {
      let value: unknown = block;
      for (let depth = 0; depth < UNWRAP_LIMIT; depth++) {
        if (typeof value !== "string") break;
        try {
          value = JSON.parse(value) as unknown;
        } catch {
          break;
        }
      }
      // Only a composite is worth re-printing: anything else either already
      // reads as itself or is the text the card was given.
      if (typeof value !== "object" || value === null) return block;
      return JSON.stringify(value, null, 2);
    })
    .join("\n\n");
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
