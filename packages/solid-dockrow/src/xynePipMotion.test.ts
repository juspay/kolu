/** Xyne's waiting pip must NEVER move — the regression pin for "when Xyne
 *  stops responding, the Dock's Xyne mark spins forever".
 *
 *  Xyne's adapter pins `AgentInfo.state` to `waiting` for the session's whole
 *  life: its persisted transcript carries no live phase, so the schema itself
 *  refuses to claim one (`kolu-xyne`'s `XyneInfoSchema` — `state` is a
 *  `Literal("waiting")`). The documented contract (`agent-detection.mdx`) is
 *  therefore "the badge sits on the dim waiting dot for the session's whole
 *  life" — a STILL mark, because kolu honestly cannot know whether Xyne is
 *  mid-turn or idle.
 *
 *  The shipped fold violates that contract from both directions:
 *
 *    1. Pre-promotion the terminal is classed `linger` (the post-turn-settle
 *       class), and `attentionActive("linger", …)` is true UNCONDITIONALLY —
 *       so it spins even with zero bytes. EF2's promotion out of `linger`
 *       needs 5 s without a single meaningful-output edge, but a waiting Xyne
 *       TUI keeps painting its turn animation into the PTY for as long as it
 *       waits on a response; when the backend hangs that is forever, so the
 *       episode never promotes. (`finishQuiet`'s `noteEdge` re-arms the
 *       debounce on every edge.)
 *
 *    2. Post-promotion the terminal is classed `finished`, whose motion is
 *       gated only on `live` — which those same TUI animation bytes hold
 *       open. `pipMotionKind` spins any active non-awaiting variant.
 *
 *  There is no third path: Xyne can never be `working`/`asking` (no phase to
 *  report) and can never leave `waiting` while alive, so neither the state
 *  channel nor the quiet channel can ever take its pip to still while its
 *  PTY emits bytes. An agent hung mid-response paints animation frames
 *  indefinitely → `live` (and pre-promotion, the EF2 debounce) stays open
 *  indefinitely → the dock's Xyne mark spins forever, long after Xyne will
 *  never answer again.
 */

import {
  type ActiveTerminal,
  LOCAL_LOCATION,
  type TerminalMetadata,
} from "@kolu/padi-client/surface";
import type { AgentInfo } from "@kolu/terminal-vocab/schema";
import { describe, expect, it } from "vitest";
import { bindStatePip } from "./pipBind.ts";

/** The one shape a live Xyne terminal can ever have: always `waiting`. */
function xyneAgent(): AgentInfo {
  return {
    kind: "xyne",
    state: "waiting",
    sessionId: "00000000-0000-7000-8000-000000000099",
    model: "juspay/kimi-k3",
    summary: "Hung session",
    taskProgress: null,
    contextTokens: null,
    startedAt: 1,
  };
}

function xyneMeta(): TerminalMetadata {
  return {
    state: "active",
    cwd: "/work/repo",
    git: null,
    location: LOCAL_LOCATION,
    pr: { kind: "absent" },
    agent: xyneAgent(),
    foreground: null,
    ports: { status: "unknown" },
    lastActivityAt: 1,
  } satisfies ActiveTerminal;
}

describe("Xyne waiting pip — dim dot, never moving", () => {
  // THE HANG, pre-promotion: the episode is still debouncing (or a hung-first-
  // turn never let it promote), the TUI's animation keeps `live` hot, and the
  // class is `linger`. `attentionActive("linger")` answers true without even
  // looking at the byte flag — so today this spins.
  it("does not spin while the hung turn holds the settle class (linger + live)", () => {
    const pip = bindStatePip({
      meta: xyneMeta(),
      attention: { klass: "linger", live: true },
      unread: false,
    });
    expect(pip.variant).toBe("linger"); // the dim waiting paint stays
    expect(pip.motion).toBe("none");
  });

  // THE HANG, post-promotion: EF2 did promote at some earlier quiet point, so
  // the frame now says `finished`; the hung TUI's animation bytes keep `live`
  // true. Motion is gated on `live` alone here — so today this spins too.
  it("does not spin while the hung TUI's bytes hold the live flag (finished + live)", () => {
    const pip = bindStatePip({
      meta: xyneMeta(),
      attention: { klass: "finished", live: true },
      unread: false,
    });
    expect(pip.variant).toBe("linger"); // finished paints the same dim dot
    expect(pip.motion).toBe("none");
  });

  // Control — the honest resting read this carve-out must not break: a Xyne
  // at a quiet prompt (no bytes, EF2 promoted) already sits still today.
  it("stays still at a quiet prompt (finished + no bytes)", () => {
    const pip = bindStatePip({
      meta: xyneMeta(),
      attention: { klass: "finished", live: false },
      unread: false,
    });
    expect(pip.variant).toBe("linger");
    expect(pip.motion).toBe("none");
    expect(pip.active).toBe(false);
  });
});
