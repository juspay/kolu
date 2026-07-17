/**
 * Shared fixtures for the `buildPadiSurfaceDeps` test suites — the ONE spelling
 * of the stub logger + fake endpoint that `servePadi.test.ts` (the terminals
 * differential) and `servePadi.recycleKaval.test.ts` (the SK3 typed rethrow)
 * both construct the deps with. Extracted so a `TerminalEndpoint` / padi-deps
 * shape change is a one-file edit, not two divergent copies (the `*.testutil`
 * convention, cf. `surface-remote/src/loggerStubs.testutil.ts`).
 */

import type { Logger } from "pino";
import type { TerminalEndpoint } from "./endpoint.ts";

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
