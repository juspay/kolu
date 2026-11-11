/** What a `tool` row DRAWS — the one mapping from the wire's tool row to the
 *  card the transcript renders.
 *
 *  Two kinds of card, and the split is the harness's, not ours: a call it
 *  positively recognised as belonging to the `kolu` MCP server it handed the
 *  session carries a structured `kolu` reading, and gets a card that can name
 *  the terminal and open it; every other call gets the generic card built from
 *  the agent's own title and the folded JSON it sent. A tool nobody could name
 *  is the direction this is safe to fail in — a generic card is honest, an
 *  invented reading is not. */

import type {
  OrchestratorKoluCall,
  OrchestratorToolRow,
} from "@kolu/padi-client/orchestrator";
import type { TerminalId } from "kolu-common/surface";
// `formatElapsedShort`, not the vocabulary's `dualPhrase`: the ladder's minute
// tier has no finer unit, so a 2m14s wait would read "2m" — and the number a
// reader is checking against a timeout is exactly the one that would be gone.
import { formatElapsedShort } from "../time/duration";

/** The card a row renders as. `kind` is the `data-testid` suffix an e2e
 *  scenario selects by, so it is the card's own vocabulary rather than the
 *  tool's name. */
export type ToolCard =
  | {
      readonly kind: "create";
      readonly terminalId: TerminalId | null;
      readonly name: string | null;
      readonly cwd: string | null;
      readonly agent: string | null;
    }
  | {
      readonly kind: "sendInput";
      readonly terminalId: TerminalId | null;
      readonly name: string | null;
      /** What went in: typed text, or one named key. Exactly one, as the tool
       *  itself requires — a call carrying neither is drawn as the bare arrow. */
      readonly sent: {
        readonly as: "text" | "key";
        readonly value: string;
      } | null;
    }
  | {
      readonly kind: "settle";
      readonly terminalId: TerminalId | null;
      readonly name: string | null;
      readonly state: string | null;
      /** The wait, already phrased (`2m 14s`). `null` when the tool reported
       *  no elapsed — a wait with no duration is not a wait of zero. */
      readonly waited: string | null;
      readonly screenTail: string | null;
    }
  | {
      readonly kind: "screen";
      readonly terminalId: TerminalId | null;
      readonly name: string | null;
      readonly snapshot: string | null;
    }
  | {
      readonly kind: "kill";
      readonly terminalId: TerminalId | null;
      readonly name: string | null;
    }
  | {
      readonly kind: "generic";
      /** The agent's own title for the call. */
      readonly title: string;
      /** The folded JSON of input and answer, when the harness sent one. */
      readonly detail: string | null;
    };

/** Project one tool row onto its card. Pure: the row carries everything, and
 *  the live half a kolu card shows (the terminal's state, its intent) is read
 *  from the terminals collection at the render site, never from here. */
export function toolCard(row: OrchestratorToolRow): ToolCard {
  const kolu: OrchestratorKoluCall | undefined = row.kolu;
  if (kolu === undefined) {
    return { kind: "generic", title: row.text, detail: row.detail ?? null };
  }
  switch (kolu.kind) {
    case "create":
      return {
        kind: "create",
        terminalId: kolu.terminalId,
        name: kolu.name,
        cwd: kolu.cwd,
        agent: kolu.agent,
      };
    case "sendInput":
      return {
        kind: "sendInput",
        terminalId: kolu.terminalId,
        name: kolu.name,
        sent:
          kolu.text !== null
            ? { as: "text", value: kolu.text }
            : kolu.key !== null
              ? { as: "key", value: kolu.key }
              : null,
      };
    case "settle":
      return {
        kind: "settle",
        terminalId: kolu.terminalId,
        name: kolu.name,
        state: kolu.state,
        waited:
          kolu.elapsedMs === null ? null : formatElapsedShort(kolu.elapsedMs),
        screenTail: kolu.screenTail,
      };
    case "screen":
      return {
        kind: "screen",
        terminalId: kolu.terminalId,
        name: kolu.name,
        snapshot: kolu.snapshot,
      };
    case "kill":
      return { kind: "kill", terminalId: kolu.terminalId, name: kolu.name };
  }
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
  row: Pick<OrchestratorToolRow, "status" | "startedAt">,
  now: number,
): string | null {
  if (row.status !== "in_progress" || row.startedAt === undefined) return null;
  const started = Date.parse(row.startedAt);
  if (Number.isNaN(started)) return null;
  const elapsed = now - started;
  if (elapsed < CLOCK_AFTER_MS) return null;
  return formatElapsedShort(elapsed);
}
