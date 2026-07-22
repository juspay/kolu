/**
 * Dual-edge pin: quiet-timer expiry re-folds urgency without a terminals write.
 * Production wiring is the same shape as servePadi's derived urgency cell.
 */

import { defineSurface } from "@kolu/surface/define";
import { derived } from "@kolu/surface/reactor";
import { implementSurface } from "@kolu/surface/server";
import type {
  AgentInfo,
  TerminalId,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import type { Logger } from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFinishQuiet } from "./finishQuiet.ts";
import {
  type PadiTerminal,
  PadiTerminalSchema,
  PadiUrgencySchema,
  urgencyEqual,
} from "./surface.ts";
import { recomputeUrgency } from "./urgency.ts";
import { composeTerminalMetadata, LOCAL_LOCATION } from "./vocab.ts";

const QUIET = 50;
const A = "00000000-0000-4000-8000-000000000001" as TerminalId;

const silentLog = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Logger;

function makeAgent(state: AgentInfo["state"]): AgentInfo {
  return {
    kind: "claude-code",
    state,
    sessionId: "s1",
    model: null,
    summary: null,
    taskProgress: null,
    workflow: null,
    contextTokens: null,
    startedAt: null,
  };
}

function activeTerminal(agent: AgentInfo | null): PadiTerminal {
  const snapshot: TerminalSnapshot = {
    cwd: "/tmp",
    git: null,
    pr: { kind: "pending" },
    agent,
    foreground: null,
  };
  return composeTerminalMetadata(
    { state: "active", location: LOCAL_LOCATION, lastActivityAt: 0 },
    snapshot,
  );
}

describe("dual-edge urgency (finish quiet generation)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("quiet timer expiry publishes finishedIds without a terminals write", () => {
    const finish = createFinishQuiet({
      log: silentLog,
      idleAfterMs: QUIET,
      standingSub: false,
    });
    const store = new Map<TerminalId, PadiTerminal>();
    store.set(A, activeTerminal(makeAgent("waiting")));

    const surface = defineSurface({
      collections: {
        terminals: {
          keySchema: TerminalIdSchema,
          schema: PadiTerminalSchema,
        },
      },
      cells: {
        urgency: {
          schema: PadiUrgencySchema,
          default: { awaitingIds: [], finishedIds: [] },
          equals: urgencyEqual,
          verbs: ["get"],
        },
      },
    });

    const { ctx } = implementSurface(surface, {
      collections: {
        terminals: {
          readAll: () => store,
          readOne: (k) => store.get(k),
          upsert: (k, v) => {
            store.set(k, v);
          },
          remove: (k) => {
            store.delete(k);
          },
          materializeSiblingView: true,
        },
      },
      cells: {
        urgency: derived.cell(($) => {
          finish.track();
          const terminals = $.terminals();
          finish.syncWaiting(terminals);
          return recomputeUrgency(terminals, (id) => finish.isLive(id));
        }),
      },
    });

    // Seed: waiting + window open → not finished.
    expect(ctx.cells.urgency.get()).toEqual({
      awaitingIds: [],
      finishedIds: [],
    });

    // Quiet expires — dual-edge must re-fold without a terminals upsert.
    vi.advanceTimersByTime(QUIET);
    expect(ctx.cells.urgency.get()).toEqual({
      awaitingIds: [],
      finishedIds: [A],
    });
    finish.dispose();
  });
});
