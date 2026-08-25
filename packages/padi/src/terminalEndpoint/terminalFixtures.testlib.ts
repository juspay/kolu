/**
 * The ACTIVE registry-entry fixture every `terminalEndpoint` unit test seeds.
 *
 * One fact lives here rather than in each test file: what a live
 * `ActiveTerminalProcess` looks like — the AUTHORED half (location + client
 * chrome + the remembered `AgentMemory` facts + the fold-derived
 * `restoreTarget`) and the OBSERVATION half, on the ONE entry the registry
 * holds. Hand-rolling that literal per file is how the copies drift: each new
 * required field then has to be learned independently by every seed.
 *
 * Sits beside `sensorTaps.testlib.ts` for the same reason it does — a
 * test-only helper, dropped from the hashed daemon source by the `.testlib.ts`
 * suffix, so seeding a terminal in a test cannot perturb `PADI_BUILD_ID`.
 */

import type {
  AgentIdentity,
  RestoreTarget,
  TerminalId,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import {
  type ActiveTerminalProcess,
  registerTerminal,
} from "../terminal-registry.ts";
import { LOCAL_LOCATION } from "../vocab.ts";
import { installSnapshot } from "./metadata.ts";

/** The native session id of the opencode conversation that was live at sleep —
 *  the EXACT conversation wake must resume (#1495). */
const SESSION_ID = "ses_118316090ffewMmbj6bsfKwj4R";

/** The agent IDENTITY the fold derived from the live agent (its `kind` + native
 *  `sessionId`) — the `exact` target's payload. */
const RESUME_AGENT: AgentIdentity = {
  kind: "opencode",
  sessionId: SESSION_ID,
};

/** The fold-derived `restoreTarget` the fixture seeds — an `exact` target carrying
 *  the launch command + the live agent's identity, so wake resumes THAT
 *  conversation by id (#1495). The `command` matches the seeded `lastAgentCommand`,
 *  exactly as `restoreTargetOf` would have produced it. */
export const EXACT_TARGET: RestoreTarget = {
  kind: "exact",
  command: "opencode --model sonnet",
  agent: RESUME_AGENT,
};

/** The OBSERVATION half — the six snapshot fields a memoryless producer emits,
 *  with a RESOLVED live `pr` (so a wake-time reset back to `pending` is
 *  meaningful, and the sleep carry-over of the restore-relevant `pr` is visible). */
function activeSnapshot(): TerminalSnapshot {
  return {
    cwd: "/work/repo",
    git: null,
    pr: {
      kind: "ok",
      value: {
        number: 42,
        title: "Fix the auth race",
        url: "https://github.com/o/r/pull/42",
        state: "open",
        checks: "pass",
        checkRuns: [],
        reviewDecision: null,
        mergeStateStatus: "UNKNOWN",
      },
    },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
  };
}

/** An active registry entry under `id`. `restoreTarget` rides an options object
 *  so a test can pass `{ restoreTarget: { kind: "none" } }` for the
 *  quit-to-shell case (wake → bare shell) or a `legacyMostRecent` target — an
 *  options bag, not a defaulted scalar, since `activeEntry(id, undefined)`
 *  would resurrect the default. */
export function activeEntry(
  id: TerminalId,
  opts: { restoreTarget?: RestoreTarget } = { restoreTarget: EXACT_TARGET },
): ActiveTerminalProcess {
  return {
    info: { id, pid: 4242 },
    meta: {
      state: "active",
      location: LOCAL_LOCATION,
      themeName: "rose",
      intent: "fix the auth race",
      // The two remembered facts + the derived restore target — the fold writes
      // these onto the authored record live; here we seed them directly.
      lastActivityAt: 123,
      lastAgentCommand: "opencode --model sonnet",
      restoreTarget: opts.restoreTarget,
    },
    snapshot: activeSnapshot(),
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

/** Seed an active terminal into the registry, then fan its snapshot out — the
 *  two steps a spawn takes, without a PTY. */
export function seedActiveTerminal(
  id: TerminalId,
  opts?: { restoreTarget?: RestoreTarget },
): ActiveTerminalProcess {
  const entry = opts === undefined ? activeEntry(id) : activeEntry(id, opts);
  registerTerminal(id, entry);
  installSnapshot(id);
  return entry;
}
