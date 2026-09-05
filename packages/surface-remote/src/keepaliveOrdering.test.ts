/**
 * The RELATION between the two halves of link liveness — pinned, because the
 * docs now make a claim about it and prose drifts.
 *
 * "How long may a link be silent" is answered by two mechanisms on the SAME
 * `makeSession({ connectOnce: sshConnector(...) })` call site:
 *
 *   - ssh's dead-peer policy (`SshKeepalive`) — governs the DIALLING phases.
 *   - the heartbeat watchdog (`MakeSessionOptions.liveness`) — governs a
 *     CONNECTED link, and is the faster judge there.
 *
 * The inversion this file exists to state out loud: at their defaults the
 * heartbeat fires BELOW the ssh tolerance, so raising `keepalive` alone does
 * nothing for a connected dial. That is not a bug — the two police different
 * phases — but it is the fact every doc sentence about the option rests on, and
 * the one a future re-tuning could silently invert. Sibling of
 * `livenessOrdering.test.ts`, which pins the pre-connected backstop the same way.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  DEFAULT_HEARTBEAT_TIMEOUT_MS,
  MAX_HEARTBEAT_INTERVAL_MS,
  MAX_HEARTBEAT_TIMEOUT_MS,
} from "@kolu/surface/heartbeat";
import {
  DEFAULT_SSH_KEEPALIVE,
  keepaliveToleranceS,
  MAX_SSH_KEEPALIVE_TOLERANCE_S,
  sshKeepalive,
} from "./keepalive";

/** Worst-case wall time before the heartbeat calls a connected link stale. */
const heartbeatVerdictMs = (intervalMs: number, timeoutMs: number): number =>
  intervalMs + timeoutMs;

/** Wall time before ssh calls the peer dead. The product is derived by
 *  `keepaliveToleranceS` — the same one the bound checks and both error
 *  messages print — so this test cannot drift from the value it is comparing. */
const keepaliveVerdictMs = (k: {
  readonly intervalS: number;
  readonly countMax: number;
}): number => keepaliveToleranceS(k) * 1_000;

describe("ssh keepalive vs the heartbeat watchdog", () => {
  it("at the defaults the heartbeat is the FASTER judge on a connected link", () => {
    const heartbeat = heartbeatVerdictMs(
      DEFAULT_HEARTBEAT_INTERVAL_MS,
      DEFAULT_HEARTBEAT_TIMEOUT_MS,
    );
    const ssh = keepaliveVerdictMs(DEFAULT_SSH_KEEPALIVE);
    expect(heartbeat).toBeLessThan(ssh);
    // The concrete numbers the docs quote, so a re-tune has to update both.
    expect(heartbeat).toBe(25_000);
    expect(ssh).toBe(30_000);
  });

  it("a raised keepalive alone cannot extend a CONNECTED link's tolerance", () => {
    // The documented CI policy. Its ssh tolerance is five minutes, but with the
    // default heartbeat the link is still force-cycled at ~25s — which is why
    // every doc sentence tells a consumer to raise `liveness` alongside.
    const ci = sshKeepalive(30, 10);
    expect(keepaliveVerdictMs(ci)).toBe(300_000);
    expect(
      heartbeatVerdictMs(
        DEFAULT_HEARTBEAT_INTERVAL_MS,
        DEFAULT_HEARTBEAT_TIMEOUT_MS,
      ),
    ).toBeLessThan(keepaliveVerdictMs(ci));
  });

  it("the matching heartbeat tuning the reference prints is actually reachable", () => {
    // ref-surface-remote.mdx shows `liveness: { intervalMs: 240_000, timeoutMs:
    // 60_000 }` beside `sshKeepalive(30, 10)`. Both halves must be
    // within the heartbeat's own ceilings or that snippet throws at runtime.
    expect(240_000).toBeLessThanOrEqual(MAX_HEARTBEAT_INTERVAL_MS);
    expect(60_000).toBeLessThanOrEqual(MAX_HEARTBEAT_TIMEOUT_MS);
    expect(heartbeatVerdictMs(240_000, 60_000)).toBe(
      keepaliveVerdictMs(sshKeepalive(30, 10)),
    );
  });

  it("records that the ssh ceiling out-runs what the heartbeat can ever match", () => {
    // Stated rather than asserted-as-good: an ssh tolerance may legitimately
    // exceed the heartbeat's reach (it is the lower-layer backstop, and it also
    // polices the phases the heartbeat does not watch at all). But a consumer
    // cannot pair a connected link with anything past this, so the excess is
    // only ever reachable during dialling.
    const heartbeatCeilingMs = heartbeatVerdictMs(
      MAX_HEARTBEAT_INTERVAL_MS,
      MAX_HEARTBEAT_TIMEOUT_MS,
    );
    expect(heartbeatCeilingMs).toBe(420_000);
    expect(MAX_SSH_KEEPALIVE_TOLERANCE_S * 1_000).toBeGreaterThan(
      heartbeatCeilingMs,
    );
  });
});
