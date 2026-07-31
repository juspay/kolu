/**
 * Shared fixtures for padi's server-side test suites — the ONE spelling of the
 * stub logger, the fake endpoint, the deps builder, the registry seed, and the
 * `caught` helper that `servePadi.test.ts` (the terminals differential),
 * `servePadi.recycleKaval.test.ts` (the SK3 typed rethrow),
 * `servePadi.nestedParent.test.ts` (#2059 at the doors) and
 * `terminal-registry.test.ts` (#2059 at the rule) all build on. Extracted so a
 * `TerminalEndpoint` / padi-deps / `AuthoredActiveTerminal` shape change is a
 * one-file edit, not four divergent copies (the `*.testutil` convention, cf.
 * `@kolu/log/loggerStubs.testutil`).
 */

import {
  seedSnapshot,
  type TerminalId,
  type TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import { ORPCError } from "@orpc/server";
import type { Logger } from "pino";
import type { TerminalEndpoint } from "./endpoint.ts";
import { buildPadiSurfaceDeps } from "./servePadi.ts";
import {
  type ActiveTerminalProcess,
  registerTerminal,
} from "./terminal-registry.ts";
import { LOCAL_LOCATION } from "./vocab.ts";

/** A stub logger — constructing the deps threads it through, but the read
 *  handlers under test never call it. */
export const stubLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => stubLog,
} as unknown as Logger;

/** A fake endpoint — the members under test read neither `fs` nor `git`, so
 *  the wrapper (`fsGitSurfaceDeps`) only needs the shape to construct. */
export const fakeEndpoint = {
  fs: {
    listAll: async () => [],
    listIgnored: async () => [],
    readFile: async () => ({ content: "", truncated: false }),
    filePreviewTag: async () => "tag",
    subscribeRepoChange: () => () => {},
    subscribeFileChange: () => () => {},
  },
  git: {
    getStatus: async () => ({}),
    getDiff: async () => ({}),
  },
} as unknown as TerminalEndpoint;

/** Build the padi surface deps over the stubs above. `stateRoot` stays per-suite
 *  (test files run in parallel and must not share a Conf directory); everything
 *  else defaults, so a deps-shape change lands here once. */
export function padiDeps(opts: {
  stateRoot: string;
  startedAt?: number;
  commit?: string;
}): ReturnType<typeof buildPadiSurfaceDeps> {
  return buildPadiSurfaceDeps({
    endpoint: fakeEndpoint,
    log: stubLog,
    startedAt: opts.startedAt ?? 0,
    commit: opts.commit ?? "",
    lifetime: { kind: "forever" },
    stateRoot: opts.stateRoot,
  });
}

/** A neutral `TerminalSnapshot` — the awareness half every seeded registry entry
 *  needs and no #2059/parked assertion reads. Off `seedSnapshot`, the vocab
 *  package's own "ONE home for the snapshot-default set", so a new snapshot field
 *  cannot leave this fixture behind. */
export const snapshot = (): TerminalSnapshot => seedSnapshot("/w");

/** Seed an ACTIVE registry entry, optionally as a split of `parentId`. The one
 *  spelling of `AuthoredActiveTerminal`'s required fields for the suites that
 *  drive the registry directly. */
export function seedActive(id: TerminalId, parentId?: string): void {
  registerTerminal(id, {
    info: { id, pid: 1 },
    meta: {
      state: "active",
      location: LOCAL_LOCATION,
      lastActivityAt: 1,
      ...(parentId !== undefined ? { parentId } : {}),
    },
    snapshot: snapshot(),
    handle: {} as ActiveTerminalProcess["handle"],
  });
}

/** Seed a SLEEPING (dormant) registry entry — {@link seedActive}'s sibling for
 *  the arm with no PTY handle. */
export function seedSleeping(id: TerminalId, parentId?: string): void {
  registerTerminal(id, {
    info: { id, pid: 1 },
    meta: {
      state: "sleeping",
      location: LOCAL_LOCATION,
      lastActivityAt: 1,
      sleptAt: 1,
      ...(parentId !== undefined ? { parentId } : {}),
    },
    snapshot: snapshot(),
  });
}

/** Seed a PARKED restore-card placeholder — {@link seedActive}'s sibling for the
 *  arm client mutations must read as absent. */
export function seedParked(id: TerminalId, parentId?: string): void {
  registerTerminal(id, {
    info: { id, pid: 1 },
    meta: {
      state: "parked",
      location: LOCAL_LOCATION,
      lastActivityAt: 1,
      parkedAt: 1,
      ...(parentId !== undefined ? { parentId } : {}),
    },
    snapshot: snapshot(),
  });
}

/** Run `fn` and return whatever it threw (or `undefined` if it didn't) — the
 *  suites assert on the fault's TYPE and message, which `expect().toThrow` can't
 *  express in one shot. */
export function caught(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

/** The oRPC fault CODE `fn` threw, as a plain string — for the many assertions
 *  that pin only "which typed fault", without the `instanceof` + cast dance
 *  {@link caught} needs when the MESSAGE is also under test. */
export function thrownCode(fn: () => unknown): string {
  const err = caught(fn);
  if (err === undefined) return "<did not throw>";
  return err instanceof ORPCError ? err.code : "<not an ORPCError>";
}
