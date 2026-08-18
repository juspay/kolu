/**
 * W12 producer-level regression — the resolved-null branch's SAMPLE-CONTENT
 * discriminant, driven through the real `startAgentSensor` (a fake adapter stands in
 * for claude/codex so we control `resolveSessions` off the foreground pid + a mutable
 * "session live" set).
 *
 * The `fold.test.ts` "twin pins" pin the FOLD's response to `unknown` vs an
 * authoritative null; they pass even if the producer picks the wrong one. These pin
 * the PRODUCER's decision instead — and it is decided by the triggering sample's OWN
 * content, with no cross-stream ordering:
 *   - SHELL-IDLE foreground + no session → authoritative `{ value: null }` (genuine end);
 *   - DEFINED NON-SHELL foreground + no session → `unknown` (the ambiguous stale-agent-
 *     pid state an unclean kaval death leaves; keep-last so `restoreTarget` survives),
 *     REGARDLESS of how many such samples arrive (the pre-death buffered burst);
 *   - the STAYS-DEFINED-UNDER-BLINDNESS invariant: a reconcile fired with NO fresh
 *     foreground sample (an ignorance trigger — title/cwd/dir-watcher) sees the LAST
 *     known DEFINED agent pid, never a false `undefined`, so it emits `unknown` not null.
 */

import pino from "pino";
import { describe, expect, it } from "vitest";
import type { AgentAdapter, AgentInfoShape } from "anyagent";
import { inMemoryChannel } from "@kolu/surface/server";
import type { ForegroundSample } from "kaval";
import type {
  TerminalPorts,
  TerminalEvent,
  TerminalId,
} from "@kolu/terminal-vocab/schema";
import {
  type CommandRunSample,
  type SensorSignals,
  freshAgentEngineState,
  startAgentSensor,
} from "./sensors.ts";

const log = pino({ level: "silent" });

const SHELL_PID = 100;
const AGENT_PID = 999;

// A live claude session's derived info — the watcher fires this once on match.
const AGENT_INFO: AgentInfoShape = {
  kind: "claude-code",
  state: "thinking",
  sessionId: "S1",
  model: null,
  summary: null,
  taskProgress: null,
  contextTokens: null,
  startedAt: null,
};

// The consume loop delivers each publish on a microtask, so a macrotask hop drains
// every queued `onEvent` (and the reconcile it fires) before we assert.
const flush = () => new Promise((resolve) => setImmediate(resolve));

interface Harness {
  emits: TerminalEvent[];
  /** Deliver a foreground sample (updates the sensor's currentForeground). */
  foreground: (sample: ForegroundSample) => Promise<void>;
  /** Fire a reconcile via a NON-foreground trigger (a title event) — the sensor's
   *  currentForeground is UNCHANGED, modelling an ignorance-triggered reconcile (the
   *  SESSIONS_DIR watcher / title / cwd) that fires under blindness with no fresh
   *  foreground sample. */
  poke: () => Promise<void>;
  /** Kill the agent's on-disk session so `resolveSessions` finds nothing for its pid —
   *  the file-unlink an unclean death (or a genuine quit) produces. */
  killSession: () => void;
  stop: () => void;
}

function startHarness(): Harness {
  const emits: TerminalEvent[] = [];
  // A defined non-shell foregroundPid IS the agent session, keyed by that pid — but
  // ONLY while its session is live; killing it makes that same pid resolve to null (the
  // stale-agent-pid ambiguous case), while the shell (or an unknown foreground) always
  // resolves to no session.
  let sessionLive = true;
  const fakeAdapter: AgentAdapter<number, AgentInfoShape> = {
    kind: "claude-code",
    commandName: "claude",
    resolveSessions: (state) =>
      sessionLive &&
      state.foregroundPid !== undefined &&
      state.foregroundPid !== SHELL_PID
        ? [state.foregroundPid]
        : [],
    sessionKey: (session) => String(session),
    sessionStartedAt: () => null,
    createWatcher: (_session, onChange) => {
      onChange(AGENT_INFO);
      return { destroy() {} };
    },
  };
  const signals: SensorSignals = {
    cwd: inMemoryChannel<string>(),
    title: inMemoryChannel<string>(),
    commandRun: inMemoryChannel<CommandRunSample>(),
    foreground: inMemoryChannel<ForegroundSample>(),
    ports: inMemoryChannel<TerminalPorts>(),
  };
  const stop = startAgentSensor(
    fakeAdapter,
    freshAgentEngineState(),
    SHELL_PID,
    "/w",
    "term-1" as TerminalId,
    signals,
    undefined,
    (o) => emits.push(o),
    log,
    false, // shell-rooted terminal
  );
  let titles = 0;
  return {
    emits,
    foreground: async (sample) => {
      signals.foreground.publish(sample);
      await flush();
    },
    poke: async () => {
      // A DISTINCT title each time so the foreground sensor's dedup never swallows it —
      // the agent sensor reconciles on every title `onEvent`.
      signals.title.publish(`t${titles++}`);
      await flush();
    },
    killSession: () => {
      sessionLive = false;
    },
    stop,
  };
}

// The `agent` events the assertions care about, in order.
const agentEvents = (emits: TerminalEvent[]) =>
  emits.filter((e) => e.kind === "agent");

const shellSample: ForegroundSample = { process: "", foregroundPid: SHELL_PID };
const agentSample: ForegroundSample = {
  process: "claude",
  foregroundPid: AGENT_PID,
};

describe("W12 — the agent sensor's resolved-null SAMPLE-CONTENT discriminant", () => {
  it("GENUINE-QUIT: a shell-idle foreground emits an authoritative null (clears the target)", async () => {
    const h = startHarness();
    try {
      await h.foreground(agentSample); // match
      await h.foreground(shellSample); // foreground moved back to the shell — genuine end

      expect(agentEvents(h.emits).at(-1)).toEqual({
        kind: "agent",
        agent: { value: null },
      });
    } finally {
      h.stop();
    }
  });

  it("AMBIGUOUS: a DEFINED non-shell foreground whose session is gone emits `unknown` (keep-last)", async () => {
    const h = startHarness();
    try {
      await h.foreground(agentSample); // match
      h.killSession(); // the agent's session file vanished (an unclean death's unlink)
      await h.poke(); // an ignorance-triggered reconcile; currentForeground is still AGENT_PID

      expect(agentEvents(h.emits).at(-1)).toEqual({
        kind: "agent",
        agent: "unknown",
      });
    } finally {
      h.stop();
    }
  });

  it("BURST: any number of DEFINED non-shell resolved-nulls stay `unknown` — never an authoritative null", async () => {
    // The pre-death buffered burst: several agent-foreground samples in flight at kaval
    // death, all resolving null. Content discrimination makes the clobber unspellable
    // regardless of count — there is no ordering to lose.
    const h = startHarness();
    try {
      await h.foreground(agentSample); // match
      h.killSession();
      // A burst of >=2 resolved-null reconciles, all with the DEFINED agent pid as
      // foreground (re-delivered buffered samples + ignorance pokes).
      await h.foreground(agentSample);
      await h.poke();
      await h.foreground(agentSample);
      await h.poke();

      const agents = agentEvents(h.emits);
      // No authoritative null was EVER emitted after the match — the target survives.
      expect(
        agents.some(
          (e) =>
            e.kind === "agent" &&
            typeof e.agent === "object" &&
            e.agent.value === null,
        ),
      ).toBe(false);
      // The last emission is `unknown` (keep-last).
      expect(agents.at(-1)).toEqual({ kind: "agent", agent: "unknown" });
    } finally {
      h.stop();
    }
  });

  it("STAYS-DEFINED-UNDER-BLINDNESS: a reconcile with NO fresh foreground sample sees the stale DEFINED pid, emits `unknown`", async () => {
    // The PRODUCER half of the load-bearing invariant: GIVEN the sensor's last foreground
    // sample is still the DEFINED agent pid (no fresh sample has overwritten it), an
    // ignorance-triggered reconcile (here a title `poke`, standing in for the SESSIONS_DIR
    // unlink watcher) resolves null and emits `unknown` — NOT the authoritative null a
    // false `foregroundPid === undefined` would produce. The OTHER half — that a foreground
    // TAP FAILURE never overwrites that sample to `undefined` in the first place — is the
    // `local.ts` foreground `onError` (log-only, no publish), whose mechanism is pinned in
    // `bridgeStream.test.ts` (a failed source never fabricates an `onEvent`). This test
    // deliberately does not re-drive that socket seam; it pins the producer's keep-last
    // given the stale sample the two guarantees together preserve.
    const h = startHarness();
    try {
      await h.foreground(agentSample); // match — currentForeground := AGENT_PID (defined)
      h.killSession(); // the session file is gone
      // NO foreground sample delivered here (the blindness): only an ignorance trigger.
      await h.poke();

      expect(agentEvents(h.emits).at(-1)).toEqual({
        kind: "agent",
        agent: "unknown",
      });
    } finally {
      h.stop();
    }
  });

  it("FLAVOR-FLIP: an ambiguous `unknown` gives way to an authoritative null once the shell returns", async () => {
    // A genuine quit after an ambiguous window: the non-shell `unknown` must not dedup
    // away the shell-idle `null`, or a dead agent stays resurrectable. `current` is
    // already null by then, so the dedup keys on the shell-idle FLAVOR flip.
    const h = startHarness();
    try {
      await h.foreground(agentSample); // match
      h.killSession();
      await h.poke(); // ambiguous → unknown
      expect(agentEvents(h.emits).at(-1)).toEqual({
        kind: "agent",
        agent: "unknown",
      });

      await h.foreground(shellSample); // the shell is genuinely back → clear
      expect(agentEvents(h.emits).at(-1)).toEqual({
        kind: "agent",
        agent: { value: null },
      });
    } finally {
      h.stop();
    }
  });
});
