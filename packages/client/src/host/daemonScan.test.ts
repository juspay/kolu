import { describe, expect, it } from "vitest";
import {
  daemonScanCause,
  type PadiEntry,
  scanUnavailableText,
} from "./daemonScan";
import { HOST_DOWN_COPY } from "./hostDownCopy";

/** A typed entry fixture — cast so the tests don't over-specify surface-map's internal
 *  membership fields (the fold only reads `.kind` and, on `failed`, `.failure.cause`). */
const entry = (e: { kind: string; failure?: unknown }): PadiEntry =>
  e as unknown as PadiEntry;

describe("daemonScanCause — total fold over the host's entry state × frame presence (#1793)", () => {
  it("connected + a real frame ⇒ live; connected without a frame ⇒ too-old", () => {
    expect(daemonScanCause(entry({ kind: "connected" }), true, true)).toEqual({
      kind: "live",
    });
    expect(daemonScanCause(entry({ kind: "connected" }), true, false)).toEqual({
      kind: "too-old",
    });
  });

  it("a stale connected over a DEAD bind ⇒ too-old, never live (the bind-liveness floor)", () => {
    // bindLive=false: the re-served inventory is frozen stale, so even a `connected`
    // entry with a (stale) frame must NOT read as a live scan.
    expect(daemonScanCause(entry({ kind: "connected" }), false, true)).toEqual({
      kind: "too-old",
    });
  });

  it("warming ⇒ connecting (the one genuinely transient cause)", () => {
    expect(daemonScanCause(entry({ kind: "warming" }), false, false)).toEqual({
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
        false,
        false,
      ),
    ).toEqual({ kind: "failed", cause: "unconverged" });
  });

  it("not-a-member ⇒ no-host", () => {
    expect(
      daemonScanCause(entry({ kind: "not-a-member" }), false, false),
    ).toEqual({
      kind: "no-host",
    });
  });
});

describe("scanUnavailableText — a total, plain-language reason per non-live cause (reuses HOST_DOWN_COPY titles)", () => {
  it("names connecting / too-old honestly", () => {
    expect(scanUnavailableText({ kind: "connecting" })).toMatch(/connecting/i);
    expect(scanUnavailableText({ kind: "too-old" })).toMatch(/too old/i);
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
