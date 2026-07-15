import { describe, expect, it } from "vitest";
import {
  ConnectionInfoSchema,
  DEFAULT_CONNECTION,
  projectConnection,
} from "./connection";
import type { SessionState } from "./session";
import type { SshProv } from "./sshConnector";

// SR9 — one connection authority. The per-host `connection` CELL (and its
// `mirroredSurface`/`WithConnection` seam + `pipeSessionStateToCell` pump) is gone: link
// health rides the host-map entry's fine `connection` payload (see `serveHostMap.test.ts`'s
// joint-invariant suite). What survives here is the browser-safe TYPE/schema + the pure
// `projectConnection` leaf a consumer derives the word from the entry with.

describe("ConnectionInfo — the browser-safe connection sum", () => {
  it("is gate-closed by default (connecting), a valid ConnectionInfo", () => {
    // The canonical pending value: `connecting`, no log, zero elapsed — what
    // `connectionOf` returns for a member before its first frame, matching the coarse arm.
    expect(DEFAULT_CONNECTION.phase).toBe("connecting");
    expect(ConnectionInfoSchema.parse(DEFAULT_CONNECTION)).toEqual(
      DEFAULT_CONNECTION,
    );
  });

  it("mirrors the session sum: up phases carry only `log` + `sinceMs` (connected also `clockOffset`), down phases require error+cause", () => {
    // UP arms except `connected` (incl. the ssh connector's `probing` opening phase)
    // — parse with only `log` + `sinceMs`, no error fields.
    for (const phase of ["probing", "copying", "building", "connecting"]) {
      expect(
        ConnectionInfoSchema.parse({ phase, log: [], sinceMs: 0 }),
      ).toEqual({ phase, log: [], sinceMs: 0 });
    }
    // `connected` ALSO carries `clockOffset` (the admit `system.clockNow` reading),
    // nullable until measured — a required field, so a connected value without it is
    // rejected.
    expect(
      ConnectionInfoSchema.parse({
        phase: "connected",
        clockOffset: null,
        log: [],
        sinceMs: 0,
      }),
    ).toEqual({ phase: "connected", clockOffset: null, log: [], sinceMs: 0 });
    expect(
      ConnectionInfoSchema.parse({
        phase: "connected",
        clockOffset: 42,
        log: [],
        sinceMs: 0,
      }),
    ).toMatchObject({ phase: "connected", clockOffset: 42 });
    expect(() =>
      ConnectionInfoSchema.parse({ phase: "connected", log: [], sinceMs: 0 }),
    ).toThrow();
    // `disconnected` requires error + cause (network | remote); `failed` pins cause
    // to the `"remote"` literal — a `failed`+`network` value is rejected.
    expect(() =>
      ConnectionInfoSchema.parse({
        phase: "disconnected",
        log: [],
        sinceMs: 0,
      }),
    ).toThrow();
    expect(
      ConnectionInfoSchema.parse({
        phase: "failed",
        error: "x",
        cause: "remote",
        log: [],
        sinceMs: 0,
      }),
    ).toMatchObject({ phase: "failed", cause: "remote" });
    expect(() =>
      ConnectionInfoSchema.parse({
        phase: "failed",
        error: "x",
        cause: "network",
        log: [],
        sinceMs: 0,
      }),
    ).toThrow();
  });

  it("projectConnection is the IDENTITY on the session sum (ConnectionInfo IS SessionState<SshProv>)", () => {
    // The value IS `SessionState<SshProv>`, so the projection is a provable identity — no
    // arm-by-arm re-box, no runtime zod-throw drift risk. A DOWN frame passes through
    // unchanged, its unified provenance-tagged log intact.
    const s: SessionState<SshProv> = {
      phase: "failed",
      error: "exited with code 1",
      cause: "remote",
      log: [
        { source: "local", line: "gave up" },
        { source: "remote", line: "kaval 3.2 vs pulam 3.3" },
      ],
      sinceMs: 4200,
    };
    expect(projectConnection(s)).toBe(s); // identity — same reference
    expect(ConnectionInfoSchema.parse(s)).toEqual(s);

    // An UP frame (the `probing` opening) likewise passes through with only log +
    // sinceMs, no invented error fields.
    const up: SessionState<SshProv> = {
      phase: "probing",
      log: [{ source: "local", line: "checking for a cached agent…" }],
      sinceMs: 0,
    };
    expect(projectConnection(up)).toBe(up);
    expect("error" in projectConnection(up)).toBe(false);
    expect(ConnectionInfoSchema.parse(up)).toEqual(up);
  });
});
