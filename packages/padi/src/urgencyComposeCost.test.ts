/**
 * SR8 named-obligation gate — the derived `urgency` cell folds `terminals` at
 * **O(M) composes per firehose cycle, not O(M²)**.
 *
 * SR7 (<#1823>) wired `urgency: derived.cell(($) => recomputeUrgency($.terminals()))`
 * off the COMPOSED `terminals` collection. Its `$`-sibling read re-ran
 * `registryMap(composePadiTerminal)` — recomposing ALL M terminals — on EVERY
 * one of the M firehose pokes/cycle → **O(M²) composes/cycle**, where each compose
 * is a real cost (object-spread for active, `SleepingTerminalSchema.parse` for
 * sleeping/parked). SR8's fix is the collection's opt-in materialized sibling view
 * (`materializeSiblingView`): the `$`-read returns a per-key cache updated by the
 * SAME publish seams (which already carry the composed value), so a poke re-composes
 * only its own key.
 *
 * This is the STRUCTURAL gate the coordinator ruled is the PRIMARY proof: it counts
 * `composePadiTerminal` invocations while driving one firehose cycle through the real
 * `implementSurface` connect seam (urgency's compute effect recomputes on each poke,
 * reading `$.terminals()`). It proves the algorithmic-complexity change by
 * construction and cannot flake. `runFirehose(false)` reproduces the pre-fix O(M²)
 * (the assertion that would be RED without the fix); `runFirehose(true)` is the O(M)
 * green. The live-padi wall-clock capture in the PR is the SUPPORTING artifact.
 */

import { defineSurface } from "@kolu/surface/define";
import { derived } from "@kolu/surface/reactor";
import { implementSurface } from "@kolu/surface/server";
import type { TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import {
  PadiTerminalSchema,
  PadiUrgencySchema,
  urgencyEqual,
} from "./surface.ts";
import { composePadiTerminal } from "./terminalEndpoint/metadata.ts";
import {
  type ActiveTerminalProcess,
  getTerminal,
  registerTerminal,
  registryMap,
  type TerminalProcess,
  unregisterTerminal,
} from "./terminal-registry.ts";
import { recomputeUrgency } from "./urgency.ts";
import { type AuthoredActiveTerminal, LOCAL_LOCATION } from "./vocab.ts";

/** A busy dev host runs ~16 live terminals; 24 keeps the O(M²)/O(M) gap
 *  unmistakable (24 vs 600) while staying a fast unit test. */
const M = 24;

const activeMeta: AuthoredActiveTerminal = {
  state: "active",
  location: LOCAL_LOCATION,
  lastActivityAt: 42,
  themeName: "rose",
  intent: "compose-cost fixture",
};

const activeSnapshot: TerminalSnapshot = {
  cwd: "/work/repo",
  git: null,
  pr: { kind: "pending" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
};

/** M distinct valid v4-shaped terminal ids. */
const idOf = (i: number): string =>
  `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

/** Drive ONE firehose cycle — every terminal pokes the composed `terminals`
 *  collection once, exactly as the ~150 ms agent firehose drives
 *  `publishComposedTerminal` per terminal — and return how many times
 *  `composePadiTerminal` ran during the cycle (the boot seed is excluded).
 *  `materialize` toggles the SR8 fix so one helper captures both before/after. */
function runFirehose(materialize: boolean): number {
  const ids = Array.from({ length: M }, (_, i) => idOf(i));
  for (const id of ids) {
    registerTerminal(id, {
      info: { id, pid: 1 },
      meta: activeMeta,
      snapshot: activeSnapshot,
      handle: {} as ActiveTerminalProcess["handle"],
    });
  }

  let composes = 0;
  const countingCompose = (entry: TerminalProcess) => {
    composes++;
    return composePadiTerminal(entry);
  };

  // A minimal surface with just the two members the regression lives in: the
  // composed `terminals` collection and the derived `urgency` cell that folds it.
  const surface = defineSurface({
    collections: {
      terminals: { keySchema: TerminalIdSchema, schema: PadiTerminalSchema },
    },
    cells: {
      urgency: {
        schema: PadiUrgencySchema,
        default: { awaitingIds: [] },
        equals: urgencyEqual,
        verbs: ["get"],
      },
    },
  });

  const runtime = implementSurface(surface, {
    collections: {
      terminals: {
        readAll: () => registryMap(countingCompose),
        readOne: (k) => {
          const e = getTerminal(k);
          return e ? countingCompose(e) : undefined;
        },
        upsert: () => {},
        remove: () => {},
        materializeSiblingView: materialize,
      },
    },
    cells: {
      // Quiet predicate: compose-cost gate is about the terminals view, not EF2.
      urgency: derived.cell(($) =>
        recomputeUrgency($.terminals(), () => false),
      ),
    },
  });

  // Reset AFTER wiring so we count only the firehose cycle, not the one-time
  // boot seed (the eager pull that materializes the view / seeds urgency).
  composes = 0;
  for (const id of ids) {
    const entry = getTerminal(id);
    if (!entry) throw new Error(`fixture entry ${id} vanished`);
    runtime.ctx.collections.terminals.upsert(id, countingCompose(entry));
  }

  for (const id of ids) unregisterTerminal(id);
  return composes;
}

describe("urgency compose cost (SR8 named obligation)", () => {
  it("materialized sibling view: O(M) composes per firehose cycle — the fix", () => {
    const composes = runFirehose(true);
    // Exactly one compose per poke — the push site (`publishComposedTerminal`).
    // The `$.terminals()` read urgency recomputes on each poke re-composes NOTHING
    // (it reads the materialized view), so no per-poke ×M fan-out.
    expect(composes).toBe(M);
  });

  it("without the view: O(M²) — the SR7 regression this gate catches (would be RED)", () => {
    const composes = runFirehose(false);
    // Push site (M) + a full `readAll()` recompose (M) on urgency's recompute per
    // poke (M) = M + M². Super-linear by construction — the debt SR8 must not ship.
    expect(composes).toBe(M + M * M);
    expect(composes).toBeGreaterThan(M * M);
  });
});
