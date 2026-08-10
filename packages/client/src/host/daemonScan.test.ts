import { describe, expect, it } from "vitest";
import type { PadiEntry } from "../kaval/useDaemonStatus";
import { daemonScanCause, scanUnavailableText } from "./daemonScan";
import { HOST_DOWN_COPY } from "./hostDownCopy";

/** A typed entry fixture — cast so the tests don't over-specify surface-map's internal
 *  membership fields (the fold only reads `.kind` and, on `failed`, `.failure.cause`;
 *  `published` is the blind arm's last-known word). */
const entry = (e: {
  kind: string;
  failure?: unknown;
  published?: string;
}): PadiEntry => e as unknown as PadiEntry;

describe("daemonScanCause — total fold over the host's entry state × frame presence (#1793)", () => {
  it("connected + live bind + a real frame ⇒ live; live bind without a frame ⇒ no-frame (not 'too old')", () => {
    expect(
      daemonScanCause(entry({ kind: "connected" }), {
        bindLive: true,
        framePresent: true,
      }),
    ).toEqual({
      kind: "live",
    });
    // A LIVE bind that simply hasn't reported a frame is honestly `no-frame` (old padi or
    // first frame pending) — never the guessed "too old".
    expect(
      daemonScanCause(entry({ kind: "connected" }), {
        bindLive: true,
        framePresent: false,
      }),
    ).toEqual({
      kind: "no-frame",
    });
  });

  it("a stale connected over a DEAD bind ⇒ connecting (reconnecting), never live nor 'too old'", () => {
    // bindLive=false on a `connected` entry means the transport dropped, so even a stale
    // frame must NOT read as live — and its honest cause is reconnecting, not "too old"
    // (the #1793 thesis: name the real reason, never guess).
    expect(
      daemonScanCause(entry({ kind: "connected" }), {
        bindLive: false,
        framePresent: true,
      }),
    ).toEqual({
      kind: "connecting",
    });
  });

  it("warming ⇒ connecting (the one genuinely transient cause)", () => {
    expect(
      daemonScanCause(entry({ kind: "warming" }), {
        bindLive: false,
        framePresent: false,
      }),
    ).toEqual({
      kind: "connecting",
    });
  });

  it("#1793: a FAILED host threads its typed cause through — never collapses to 'connecting'", () => {
    // The exact bug: an ssh-unreachable host is `failed`, not `connecting`. The cause
    // rides straight through so the copy can name the real reason.
    expect(
      daemonScanCause(
        entry({
          kind: "failed",
          failure: { cause: "unconverged", reason: "x" },
        }),
        { bindLive: false, framePresent: false },
      ),
    ).toEqual({ kind: "failed", cause: "unconverged" });
  });

  it("unobservable ⇒ its OWN cause — 'we cannot see kolu' is never folded into 'padi is connecting'", () => {
    // The pin that would fail under the old collapsed shape. A dead browser↔server link used
    // to reach this fold as `warming`, so the section said "padi is connecting" — a claim
    // about a dial campaign we are in no position to observe, over a host that may be
    // perfectly up. Now the entry says which it is, and the copy follows.
    expect(
      daemonScanCause(entry({ kind: "unobservable", published: "connected" }), {
        bindLive: false,
        framePresent: false,
      }),
    ).toEqual({ kind: "unobservable" });
    expect(scanUnavailableText({ kind: "unobservable" })).not.toBe(
      scanUnavailableText({ kind: "connecting" }),
    );
    expect(scanUnavailableText({ kind: "unobservable" })).toContain("kolu");
  });

  it("not-a-member ⇒ no-host", () => {
    expect(
      daemonScanCause(entry({ kind: "not-a-member" }), {
        bindLive: false,
        framePresent: false,
      }),
    ).toEqual({
      kind: "no-host",
    });
  });
});

describe("scanUnavailableText — a total, plain-language reason per non-live cause (reuses HOST_DOWN_COPY titles)", () => {
  it("names connecting / no-frame honestly (never a guessed 'too old')", () => {
    expect(scanUnavailableText({ kind: "connecting" })).toMatch(/connecting/i);
    expect(scanUnavailableText({ kind: "no-frame" })).toMatch(
      /hasn't reported|has not reported|no scan/i,
    );
  });

  it("#1793: a failed host's copy is the matching HOST_DOWN_COPY title, NOT 'connecting'", () => {
    const text = scanUnavailableText({
      kind: "failed",
      cause: "cross-supervisor",
    });
    expect(text).toContain(HOST_DOWN_COPY["cross-supervisor"].title);
    expect(text).not.toMatch(/connecting/i);
  });

  it("no-host reads its own honest line", () => {
    expect(scanUnavailableText({ kind: "no-host" })).toMatch(/no padi/i);
  });
});
