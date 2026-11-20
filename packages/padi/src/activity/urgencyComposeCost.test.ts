import {
  type AuthoredActiveTerminal,
  LOCAL_LOCATION,
  PadiTerminalSchema,
  PadiUrgencySchema,
  urgencyEqual,
} from "@kolu/padi-client/surface";
import { defineSurface } from "@kolu/surface/define";
import { derived } from "@kolu/surface/reactor";
import { implementSurface } from "@kolu/surface/server";
import type { TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import {
  type ActiveTerminalProcess,
  getTerminal,
  registerTerminal,
  registryMap,
  type TerminalProcess,
  unregisterTerminal,
} from "../terminal-registry.ts";
import { composePadiTerminal } from "../terminalEndpoint/metadata.ts";
import { recomputeUrgency } from "./urgency.ts";

const M = 24;

const activeMeta: AuthoredActiveTerminal = {
  state: "active",
  location: LOCAL_LOCATION,
  lastActivityAt: 42,
  promptedAt: null,
  themeName: "rose",
  intent: "compose-cost fixture",
};

const activeSnapshot: TerminalSnapshot = {
  cwd: "/work/repo",
  git: { kind: "none" },
  pr: { kind: "pending" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
};

const idOf = (i: number): string =>
  `${i.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

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
      urgency: derived.cell(($) =>
        recomputeUrgency($.terminals(), () => false),
      ),
    },
  });

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
    expect(composes).toBe(M);
  });

  it("without the view: O(M²) — the SR7 regression this gate catches (would be RED)", () => {
    const composes = runFirehose(false);
    expect(composes).toBe(M + M * M);
    expect(composes).toBeGreaterThan(M * M);
  });
});
