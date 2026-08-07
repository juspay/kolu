import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  ConnectionInfoSchema,
  DEFAULT_CONNECTION,
  projectConnection,
  sessionConnection,
} from "./connection";
import type { SessionState } from "./session";
import type { SshProv } from "./sshConnector";

/** The zod-era `ConnectionInfoSchema.parse` — Effect Schema splits parse into a
 *  decoder factory, so name it once here rather than at eleven call sites. */
const parseConnectionInfo = Schema.decodeUnknownSync(ConnectionInfoSchema);
const encodeConnectionInfo = Schema.encodeUnknownSync(ConnectionInfoSchema);

// SR9 — one connection authority. The per-host `connection` CELL (and its
// `mirroredSurface`/`WithConnection` seam + `pipeSessionStateToCell` pump) is gone: link
// health rides the host-map entry's fine `connection` payload (see `serveHostMap.test.ts`'s
// joint-invariant suite). What survives here is the browser-safe TYPE/schema + the pure
// `projectConnection` leaf a consumer derives the word from the entry with.

describe("ConnectionInfo — the browser-safe connection sum", () => {
  it("is gate-closed by default (connecting), a valid ConnectionInfo", () => {
    // The canonical pending value: `connecting`, no log, zero elapsed — what
    // `sessionConnection` returns for a member before its first frame, matching the coarse arm.
    expect(DEFAULT_CONNECTION.phase).toBe("connecting");
    expect(parseConnectionInfo(DEFAULT_CONNECTION)).toEqual(DEFAULT_CONNECTION);
  });

  it("mirrors the session sum: up phases carry only `log` + `sinceMs` (connected also `clockOffset`), down phases require error+cause", () => {
    // UP arms except `connected` (incl. the ssh connector's `probing` opening phase)
    // — parse with only `log` + `sinceMs`, no error fields.
    for (const phase of ["probing", "provisioning", "connecting"]) {
      expect(
        parseConnectionInfo({
          phase,
          log: [],
          sinceMs: 0,
          campaignEpoch: 0,
        }),
      ).toEqual({ phase, log: [], sinceMs: 0, campaignEpoch: 0 });
    }
    // `connected` ALSO carries `clockOffset` (the admit `system.clockNow` reading),
    // nullable until measured — a required field, so a connected value without it is
    // rejected.
    expect(
      parseConnectionInfo({
        phase: "connected",
        clockOffset: null,
        log: [],
        sinceMs: 0,
        campaignEpoch: 0,
      }),
    ).toEqual({
      phase: "connected",
      clockOffset: null,
      log: [],
      sinceMs: 0,
      campaignEpoch: 0,
    });
    expect(
      parseConnectionInfo({
        phase: "connected",
        clockOffset: 42,
        log: [],
        sinceMs: 0,
        campaignEpoch: 0,
      }),
    ).toMatchObject({ phase: "connected", clockOffset: 42 });
    expect(() =>
      parseConnectionInfo({ phase: "connected", log: [], sinceMs: 0 }),
    ).toThrow();
    // `disconnected` requires error + cause (network | remote); `failed` now accepts
    // cause `network | remote` too — terminality is the phase, orthogonal to the transport
    // cause (a budget-exhausted silent copy fails `"network"`; #1908 F3).
    expect(() =>
      parseConnectionInfo({
        phase: "disconnected",
        log: [],
        sinceMs: 0,
        campaignEpoch: 0,
      }),
    ).toThrow();
    expect(
      parseConnectionInfo({
        phase: "failed",
        error: "x",
        cause: "remote",
        log: [],
        sinceMs: 0,
        campaignEpoch: 0,
      }),
    ).toMatchObject({ phase: "failed", cause: "remote" });
    expect(
      parseConnectionInfo({
        phase: "failed",
        error: "x",
        cause: "network",
        log: [],
        sinceMs: 0,
        campaignEpoch: 0,
      }),
    ).toMatchObject({ phase: "failed", cause: "network" });
    // …but a bogus cause is still rejected.
    expect(() =>
      parseConnectionInfo({
        phase: "failed",
        error: "x",
        cause: "banana",
        log: [],
        sinceMs: 0,
        campaignEpoch: 0,
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
      campaignEpoch: 0,
    };
    expect(projectConnection(s)).toBe(s); // identity — same reference
    expect(parseConnectionInfo(s)).toEqual(s);

    // An UP frame (the `probing` opening) likewise passes through with only log +
    // sinceMs, no invented error fields.
    const up: SessionState<SshProv> = {
      phase: "probing",
      log: [{ source: "local", line: "checking for a cached agent…" }],
      sinceMs: 0,
      campaignEpoch: 0,
    };
    expect(projectConnection(up)).toBe(up);
    expect("error" in projectConnection(up)).toBe(false);
    expect(parseConnectionInfo(up)).toEqual(up);
  });
});

describe("sessionConnection — the erased-frame → ConnectionInfo seam", () => {
  it("returns a valid frame BY REFERENCE (reference stability for the entries equals dedup)", () => {
    const frame: SessionState<string> = {
      phase: "connected",
      clockOffset: 42,
      log: [],
      sinceMs: 0,
      campaignEpoch: 0,
    };
    // Not a clone — the SAME object, so a re-projection of an unchanged cached frame is
    // reference-equal and the entries `equals` can dedup it.
    expect(sessionConnection(frame)).toBe(frame);
  });

  it("folds a not-yet-seeded member (undefined) to the gate-closed DEFAULT_CONNECTION", () => {
    expect(sessionConnection(undefined)).toBe(DEFAULT_CONNECTION);
  });

  it("FAILS LOUD on a malformed known phase — `connected` without `clockOffset`", () => {
    // The exact hole the phase-allowlist attempt missed: a KNOWN phase name whose
    // arm-specific fields are absent. Whole-frame validation catches it.
    const malformed = {
      phase: "connected",
      log: [],
      sinceMs: 0,
      campaignEpoch: 0,
    } as unknown as SessionState<string>;
    expect(() => sessionConnection(malformed)).toThrow(
      /not a valid ConnectionInfo/,
    );
  });

  it("FAILS LOUD on a down arm missing error/cause", () => {
    const malformed = {
      phase: "disconnected",
      log: [],
      sinceMs: 0,
      campaignEpoch: 0,
    } as unknown as SessionState<string>;
    expect(() => sessionConnection(malformed)).toThrow(
      /not a valid ConnectionInfo/,
    );
  });

  it("FAILS LOUD on an unknown (non-ssh) provisioning phase", () => {
    const alien = {
      phase: "deploying",
      log: [],
      sinceMs: 0,
      campaignEpoch: 0,
    } as unknown as SessionState<string>;
    expect(() => sessionConnection(alien)).toThrow(
      /not a valid ConnectionInfo/,
    );
  });
});

describe("ConnectionInfo — the ENCODED bytes (byte-compat hit list)", () => {
  // `ConnectionInfoSchema` is on the byte-compatibility hit list: the value crosses
  // the ssh mirror hop as the host-map entry's fine `connection` payload, and drishti
  // consumes the same shape from a DIFFERENT build. Encode-equality, not just
  // decode-equality — the #17 divergences (`optionalKey` vs `optional`, a `null` that
  // becomes an absent key, a discriminant that becomes `_tag`) are only visible in the
  // emitted JSON STRING, so these assert the string literally.
  const encoded = (v: unknown): string =>
    JSON.stringify(encodeConnectionInfo(parseConnectionInfo(v)));

  it("emits an UP arm with no error fields and no `_tag`", () => {
    expect(
      encoded({ phase: "probing", log: [], sinceMs: 0, campaignEpoch: 0 }),
    ).toBe('{"phase":"probing","log":[],"sinceMs":0,"campaignEpoch":0}');
  });

  it("emits `connected` with a REAL null clockOffset (never an absent key)", () => {
    expect(
      encoded({
        phase: "connected",
        clockOffset: null,
        log: [{ source: "local", line: "up" }],
        sinceMs: 5,
        campaignEpoch: 2,
      }),
    ).toBe(
      '{"phase":"connected","clockOffset":null,"log":[{"source":"local","line":"up"}],' +
        '"sinceMs":5,"campaignEpoch":2}',
    );
    expect(
      encoded({
        phase: "connected",
        clockOffset: -42,
        log: [],
        sinceMs: 5,
        campaignEpoch: 2,
      }),
    ).toBe(
      '{"phase":"connected","clockOffset":-42,"log":[],"sinceMs":5,"campaignEpoch":2}',
    );
  });

  it("emits both DOWN arms with error+cause in declaration order", () => {
    expect(
      encoded({
        phase: "disconnected",
        error: "link dropped",
        cause: "network",
        log: [{ source: "remote", line: "bye" }],
        sinceMs: 1,
        campaignEpoch: 3,
      }),
    ).toBe(
      '{"phase":"disconnected","error":"link dropped","cause":"network",' +
        '"log":[{"source":"remote","line":"bye"}],"sinceMs":1,"campaignEpoch":3}',
    );
    expect(
      encoded({
        phase: "failed",
        error: "gave up",
        cause: "remote",
        log: [],
        sinceMs: 9,
        campaignEpoch: 0,
      }),
    ).toBe(
      '{"phase":"failed","error":"gave up","cause":"remote","log":[],' +
        '"sinceMs":9,"campaignEpoch":0}',
    );
  });
});
