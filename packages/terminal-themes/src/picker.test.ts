import { describe, expect, it } from "vitest";
import { hexToOkLab, okLabDistance, pickTheme } from "./picker";
import type { NamedTheme } from "./theme";

function mk(name: string, background: string): NamedTheme {
  return { name, theme: { background } };
}

type NonEmptyThemes = [NamedTheme, ...NamedTheme[]];

// Fixed-sequence rand — useful for making tiebreakers deterministic.
function seqRand(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length] ?? 0;
}

describe("hexToOkLab", () => {
  it("parses #rrggbb", () => {
    const lab = hexToOkLab("#000000");
    if (lab === undefined) throw new Error("#000000 should parse");
    expect(lab.L).toBeCloseTo(0, 5);
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
    const white = hexToOkLab("#ffffff");
    const black = hexToOkLab("#000000");
    if (white === undefined) throw new Error("#ffffff should parse");
    if (black === undefined) throw new Error("#000000 should parse");
    expect(white.L).toBeGreaterThan(black.L);
    expect(white.L).toBeCloseTo(1, 2);
  });
});

describe("okLabDistance", () => {
  it("is zero for identical colours", () => {
    const a = hexToOkLab("#282a36");
    if (a === undefined) throw new Error("#282a36 should parse");
    expect(okLabDistance(a, a)).toBe(0);
  });

  it("down-weights luminance relative to hue", () => {
    const ref = { L: 0.5, a: 0, b: 0 };
    const lightShift = { L: 0.7, a: 0, b: 0 };
    const hueShift = { L: 0.5, a: 0.2, b: 0 };
    expect(okLabDistance(ref, hueShift)).toBeGreaterThan(
      okLabDistance(ref, lightShift),
    );
  });
});

describe("pickTheme – spread mode", () => {
  it("with no peer bgs, rand picks uniformly", () => {
    const candidates: NonEmptyThemes = [
      mk("A", "#111111"),
      mk("B", "#222222"),
      mk("C", "#333333"),
    ];
    expect(
      pickTheme(candidates, { spread: true, peerBgs: [], rand: () => 0 }),
    ).toBe("A");
    expect(
      pickTheme(candidates, {
        spread: true,
        peerBgs: [],
        rand: () => 0.99,
      }),
    ).toBe("C");
  });

  it("never picks a candidate whose bg matches a peer bg exactly", () => {
    // Identical bg scores 0 distance; any other parseable candidate wins.
    const candidates: NonEmptyThemes = [
      mk("Same", "#282a36"),
      mk("Other", "#ffffff"),
    ];
    expect(pickTheme(candidates, { spread: true, peerBgs: ["#282a36"] })).toBe(
      "Other",
    );
  });

  it("maximises distance across multiple peers", () => {
    // Peers cluster in blue-ish dark territory; green-tinted candidate is
    // farthest and should be picked regardless of rand.
    const candidates: NonEmptyThemes = [
      mk("Blueish", "#222244"),
      mk("PurpleDark", "#332244"),
      mk("GreenTint", "#224422"),
    ];
    const peerBgs = ["#222244", "#2a2a50"];
    expect(
      pickTheme(candidates, { spread: true, peerBgs, rand: () => 0 }),
    ).toBe("GreenTint");
  });

  it("rejects candidates whose bg chroma exceeds the garish cap", () => {
    // Without a chroma cap the picker would gleefully pick neon bgs —
    // they're the farthest points in colour space.
    const candidates: NonEmptyThemes = [
      mk("Tasteful", "#1d1f21"),
      mk("BrightYellow", "#ffff00"),
    ];
    expect(pickTheme(candidates, { spread: true, peerBgs: ["#000000"] })).toBe(
      "Tasteful",
    );
  });

  it("skips candidates without a parseable bg", () => {
    const candidates: NonEmptyThemes = [
      mk("NoBg", ""),
      mk("Named", "red"),
      mk("Real", "#123456"),
    ];
    expect(pickTheme(candidates, { spread: true, peerBgs: ["#fedcba"] })).toBe(
      "Real",
    );
  });

  it("falls back to an unparseable candidate when it's all that's left", () => {
    const candidates: NonEmptyThemes = [mk("Broken", "not-a-color")];
    expect(pickTheme(candidates, { spread: true, peerBgs: [] })).toBe("Broken");
  });

  it("is nondeterministic — different rand values produce different picks", () => {
    const candidates: NonEmptyThemes = [
      mk("A", "#1a1a2e"),
      mk("B", "#16213e"),
      mk("C", "#0f3460"),
      mk("D", "#533483"),
      mk("E", "#2b2b2b"),
    ];
    const peerBgs = ["#000000"];
    const results = new Set<string>();
    for (const r of [0.0, 0.2, 0.4, 0.6, 0.8, 0.99]) {
      results.add(
        pickTheme(candidates, { spread: true, peerBgs, rand: () => r }),
      );
    }
    expect(results.size).toBeGreaterThan(1);
  });
});

describe("pickTheme – shuffle mode", () => {
  // Regression: argmax-style picking ping-pongs between two themes
  // (A's farthest is B, B's farthest is A). Shuffle mode must not do that.
  it("does not ping-pong when looped — random, not deterministic argmax", () => {
    const themes: NonEmptyThemes = [
      mk("A", "#000000"),
      mk("B", "#202020"),
      mk("C", "#404040"),
      mk("D", "#606060"),
    ];
    let current = "A";
    const visited: string[] = [current];
    const rand = seqRand(0.0, 0.34, 0.67, 0.99, 0.5);
    for (let i = 0; i < 4; i++) {
      const [first, ...rest] = themes.filter((t) => t.name !== current);
      if (first === undefined)
        throw new Error("fixture invariant: at least one other theme");
      const currentTheme = themes.find((t) => t.name === current);
      if (currentTheme === undefined)
        throw new Error(`theme ${current} not in fixture`);
      const currentBg = currentTheme.theme.background;
      if (currentBg === undefined)
        throw new Error(`theme ${current} has no background`);
      current = pickTheme([first, ...rest], { excludeBgs: [currentBg], rand });
      visited.push(current);
    }
    expect(new Set(visited).size).toBeGreaterThan(3);
  });

  it("excludes garish (high-chroma) candidates by default", () => {
    const candidates: NonEmptyThemes = [
      mk("Tasteful", "#1d1f21"),
      mk("BrightYellow", "#ffff00"),
    ];
    expect(pickTheme(candidates, { excludeBgs: [], rand: () => 0 })).toBe(
      "Tasteful",
    );
    expect(pickTheme(candidates, { excludeBgs: [], rand: () => 0.99 })).toBe(
      "Tasteful",
    );
  });

  it("excludes any candidate whose bg is in excludeBgs", () => {
    const candidates: NonEmptyThemes = [
      mk("Now", "#1d1f21"),
      mk("Other", "#282a36"),
    ];
    expect(
      pickTheme(candidates, { excludeBgs: ["#1d1f21"], rand: () => 0 }),
    ).toBe("Other");
    expect(
      pickTheme(candidates, { excludeBgs: ["#1d1f21"], rand: () => 0.99 }),
    ).toBe("Other");
  });

  it("falls back to full candidates when filters leave nothing", () => {
    const candidates: NonEmptyThemes = [mk("A", "#111111"), mk("B", "#222222")];
    const result = pickTheme(candidates, {
      excludeBgs: ["#111111", "#222222"],
      rand: () => 0,
    });
    expect(["A", "B"]).toContain(result);
  });

  it("uses rand to pick among the acceptable pool", () => {
    const candidates: NonEmptyThemes = [
      mk("A", "#101010"),
      mk("B", "#202020"),
      mk("C", "#303030"),
      mk("D", "#404040"),
    ];
    expect(pickTheme(candidates, { excludeBgs: [], rand: () => 0 })).toBe("A");
    expect(pickTheme(candidates, { excludeBgs: [], rand: () => 0.25 })).toBe(
      "B",
    );
    expect(pickTheme(candidates, { excludeBgs: [], rand: () => 0.5 })).toBe(
      "C",
    );
    expect(pickTheme(candidates, { excludeBgs: [], rand: () => 0.99 })).toBe(
      "D",
    );
  });
});
