import { describe, it, expect } from "vitest";
import { hexToOkLab, okLabDistance, pickVariegatedTheme } from "./themePicker";
import type { NamedTheme } from "./theme";

function mk(name: string, background: string): NamedTheme {
  return { name, theme: { background } };
}

// Fixed-sequence rand — useful for making tiebreakers deterministic.
function seqRand(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

describe("hexToOkLab", () => {
  it("parses #rrggbb", () => {
    const lab = hexToOkLab("#000000");
    expect(lab).toBeDefined();
    expect(lab!.L).toBeCloseTo(0, 5);
  });

  it("parses #rgb shorthand same as full form", () => {
    const a = hexToOkLab("#f00");
    const b = hexToOkLab("#ff0000");
    expect(a).toEqual(b);
  });

  it("rejects non-hex", () => {
    expect(hexToOkLab("red")).toBeUndefined();
    expect(hexToOkLab("#1234")).toBeUndefined();
    expect(hexToOkLab("#12345678")).toBeUndefined();
    expect(hexToOkLab("")).toBeUndefined();
  });

  it("white has max L", () => {
    const white = hexToOkLab("#ffffff")!;
    const black = hexToOkLab("#000000")!;
    expect(white.L).toBeGreaterThan(black.L);
    expect(white.L).toBeCloseTo(1, 2);
  });
});

describe("okLabDistance", () => {
  it("is zero for identical colours", () => {
    const a = hexToOkLab("#282a36")!;
    expect(okLabDistance(a, a)).toBe(0);
  });

  it("down-weights luminance relative to hue", () => {
    // For two candidates with the same peer, the one whose delta is purely
    // in luminance (Δa=Δb=0) should score less distant than the one whose
    // delta is in the a-axis only, at equal raw magnitudes. This is a
    // direct algebraic consequence of `dL / L_DOWNWEIGHT` — luminance is
    // the only axis that gets divided, so equal |Δ| on (a,b) produces a
    // strictly larger distance than equal |Δ| on L.
    const ref = { L: 0.5, a: 0, b: 0 };
    const lightShift = { L: 0.7, a: 0, b: 0 };
    const hueShift = { L: 0.5, a: 0.2, b: 0 };
    expect(okLabDistance(ref, hueShift)).toBeGreaterThan(
      okLabDistance(ref, lightShift),
    );
  });
});

describe("pickVariegatedTheme", () => {
  it("throws when candidates is empty", () => {
    expect(() => pickVariegatedTheme([], [])).toThrow();
  });

  it("with no used bgs, rand picks the tiebreaker", () => {
    const candidates = [
      mk("A", "#111111"),
      mk("B", "#222222"),
      mk("C", "#333333"),
    ];
    // rand()=0 → first tied candidate (index 0)
    expect(pickVariegatedTheme(candidates, [], () => 0)).toBe("A");
    // rand()=0.99 → last tied candidate. Tie group has length 3, floor(0.99*3)=2.
    expect(pickVariegatedTheme(candidates, [], () => 0.99)).toBe("C");
  });

  it("never picks a candidate whose bg matches a used bg exactly", () => {
    // When one candidate's bg is identical to the only used bg, it scores 0;
    // any other parseable candidate scores > 0 and wins.
    const candidates = [mk("Same", "#282a36"), mk("Other", "#ffffff")];
    expect(pickVariegatedTheme(candidates, ["#282a36"])).toBe("Other");
  });

  it("maximises distance across multiple peers", () => {
    // Peers cluster in blue-ish dark territory; green-tinted candidate is
    // farthest and should be picked regardless of tie-breaking rand.
    const candidates = [
      mk("Blueish", "#222244"),
      mk("PurpleDark", "#332244"),
      mk("GreenTint", "#224422"),
    ];
    const peers = ["#222244", "#2a2a50"];
    expect(pickVariegatedTheme(candidates, peers, () => 0)).toBe("GreenTint");
  });

  it("prefers a saturated hue swing over a pure luminance swing", () => {
    // Peer at pure black. Choice between:
    //   - a medium grey (pure luminance delta, ~ΔL=0.51)
    //   - a saturated red (smaller luminance delta + hue delta)
    // Because luminance is down-weighted, the saturated-red wins even
    // though its raw |ΔL| is smaller. This is the concrete consequence
    // of `L_DOWNWEIGHT > 1` that keeps a mostly-dark palette mostly-dark
    // when a clearly hue-distant candidate is available.
    const candidates = [
      mk("MediumGrey", "#666666"),
      mk("SaturatedRed", "#cc0000"),
    ];
    const peer = ["#000000"];
    expect(pickVariegatedTheme(candidates, peer, () => 0)).toBe("SaturatedRed");
  });

  it("skips candidates without a parseable bg", () => {
    const candidates = [
      mk("NoBg", ""),
      mk("Named", "red" /* not #hex → unparseable */),
      mk("Real", "#123456"),
    ];
    expect(pickVariegatedTheme(candidates, ["#fedcba"])).toBe("Real");
  });

  it("falls back to an unparseable candidate when it's all that's left", () => {
    const candidates = [mk("Broken", "not-a-color")];
    expect(pickVariegatedTheme(candidates, [])).toBe("Broken");
  });

  it("tiebreaker uses rand across every maximally-distant candidate", () => {
    // Two candidates at exactly the same max distance from the peer.
    const candidates = [
      mk("Left", "#ff0000"),
      mk("Right", "#ff0000"), // identical bg → identical score
      mk("Closer", "#100000"),
    ];
    const peer = ["#000000"];
    // rand()=0 → index 0 of tie group ("Left")
    expect(pickVariegatedTheme(candidates, peer, () => 0)).toBe("Left");
    // rand()=0.99 → floor(0.99*2)=1 → "Right"
    expect(pickVariegatedTheme(candidates, peer, () => 0.99)).toBe("Right");
  });

  it("is a pure function — same inputs give same output", () => {
    const candidates = [
      mk("A", "#aa0000"),
      mk("B", "#00aa00"),
      mk("C", "#0000aa"),
    ];
    const peers = ["#333333"];
    const rand = seqRand(0.5);
    const first = pickVariegatedTheme(candidates, peers, rand);
    const second = pickVariegatedTheme(candidates, peers, rand);
    expect(first).toBe(second);
  });
});
