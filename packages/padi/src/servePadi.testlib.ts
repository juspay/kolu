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

import type { TerminalId, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
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
 *  needs and no #2059/parked assertion reads. */
export const snapshot = (): TerminalSnapshot => ({
  cwd: "/w",
  git: null,
  pr: { kind: "absent" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
});

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
