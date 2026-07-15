/**
 * `reactiveFamily` + `derived.registry` — SR9's keyed machinery (the split of the
 * old `registryFromFamily` along the source/exit axis). These pin the four
 * responsibilities the note assigns to the family — membership diff, last-frame
 * hold, per-key disposal, per-member error isolation — plus the pull-face exit's
 * on-demand resolve and change edge, without standing up a full surface.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { derived, reactiveFamily, source } from "./reactor";

/** A hand-driven family fixture: a manual membership emitter plus manual per-key
 *  `set` handles, so a test drives membership and state transitions explicitly and
 *  observes disposal/eviction. `seed` (default off) makes `attach` seed a first frame
 *  synchronously, modelling a snapshot-then-delta source. */
function makeFamily<S>(
  initial: string[],
  opts: { seed?: (key: string) => S } = {},
) {
  let emitMembers!: (keys: string[]) => void;
  const members = source<readonly string[]>((emit) => {
    emitMembers = emit;
    return () => {};
  }, initial);
  const setters = new Map<string, (s: S) => void>();
  const disposed: string[] = [];
  const evicted: string[] = [];
  const family = reactiveFamily<string, S>({
    members,
    attach: (key, set) => {
      setters.set(key, set);
      if (opts.seed) set(opts.seed(key));
      return () => {
        disposed.push(key);
      };
    },
    onEvict: (key) => evicted.push(key),
  });
  return {
    family,
    emitMembers: (keys: string[]) => emitMembers(keys),
    emitState: (key: string, s: S) => setters.get(key)?.(s),
    disposed,
    evicted,
  };
}

describe("reactiveFamily — membership diff + last-frame hold", () => {
  it("seeds the initial membership from the source level", () => {
    const f = makeFamily<number>(["a", "b"], { seed: () => 0 });
    expect(new Set(f.family.keys())).toEqual(new Set(["a", "b"]));
    expect(f.family.has("a")).toBe(true);
    expect(f.family.has("z")).toBe(false);
    expect(f.family.get("a")).toBe(0);
    f.family.dispose();
  });

  it("attaches entrants and detaches leavers on a membership frame", () => {
    const f = makeFamily<number>(["a"], { seed: () => 0 });
    f.emitMembers(["a", "b", "c"]);
    expect(new Set(f.family.keys())).toEqual(new Set(["a", "b", "c"]));
    f.emitMembers(["b"]);
    expect(f.family.keys()).toEqual(["b"]);
    expect(f.family.has("a")).toBe(false);
    expect(f.disposed).toContain("a");
    expect(f.disposed).toContain("c");
    expect(f.evicted).toContain("a");
    f.family.dispose();
  });

  it("holds each member's LAST frame (get returns the latest state)", () => {
    const f = makeFamily<string>(["a"], { seed: () => "warming" });
    expect(f.family.get("a")).toBe("warming");
    f.emitState("a", "connected");
    expect(f.family.get("a")).toBe("connected");
    f.emitState("a", "disconnected");
    expect(f.family.get("a")).toBe("disconnected");
    f.family.dispose();
  });

  it("reports an attached-but-unseeded member (get undefined until its first frame)", () => {
    const f = makeFamily<number>(["a"]); // no seed
    expect(f.family.has("a")).toBe(true); // a member…
    expect(f.family.get("a")).toBeUndefined(); // …with no frame yet
    f.emitState("a", 42);
    expect(f.family.get("a")).toBe(42);
    f.family.dispose();
  });
});

describe("reactiveFamily — per-key disposal + per-member error isolation", () => {
  it("runs the member disposer then onEvict on key exit", () => {
    const f = makeFamily<number>(["a", "b"], { seed: () => 0 });
    f.emitMembers(["a"]); // b leaves
    expect(f.disposed).toEqual(["b"]);
    expect(f.evicted).toEqual(["b"]);
    f.family.dispose();
  });

  it("isolates a throwing attach — the member is skipped, siblings unaffected", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    let emitMembers!: (keys: string[]) => void;
    const members = source<readonly string[]>(
      (emit) => {
        emitMembers = emit;
        return () => {};
      },
      ["good", "bad"],
    );
    const family = reactiveFamily<string, number>({
      members,
      attach: (key, set) => {
        if (key === "bad") throw new Error("attach boom");
        set(1);
        return () => {};
      },
    });
    // "bad" was skipped (its attach threw) but "good" attached and seeded fine.
    expect(family.get("good")).toBe(1);
    expect(errSpy).toHaveBeenCalled();
    // The family keeps working — a later membership frame still reconciles.
    emitMembers(["good"]);
    expect(family.keys()).toEqual(["good"]);
    family.dispose();
    errSpy.mockRestore();
  });
});

describe("reactiveFamily — the change edge (subscribe)", () => {
  it("fires on a membership transition AND on a state frame, never on subscribe", () => {
    const f = makeFamily<number>(["a"], { seed: () => 0 });
    const onChange = vi.fn();
    const off = f.family.subscribe(onChange);
    expect(onChange).not.toHaveBeenCalled(); // not on subscribe
    f.emitState("a", 1);
    expect(onChange).toHaveBeenCalledTimes(1); // a state frame
    f.emitMembers(["a", "b"]);
    expect(onChange).toHaveBeenCalledTimes(2); // a membership transition
    off();
    f.emitState("a", 2);
    expect(onChange).toHaveBeenCalledTimes(2); // unsubscribed
    f.family.dispose();
  });

  it("observes a remove and a re-add as TWO transitions (clause-3, non-coalescing)", () => {
    const f = makeFamily<number>(["a", "b"], { seed: () => 0 });
    const seen: Array<string[]> = [];
    f.family.subscribe(() => seen.push(f.family.keys().slice().sort()));
    f.emitMembers(["a"]); // b leaves
    f.emitMembers(["a", "b"]); // b re-adds
    expect(seen).toEqual([["a"], ["a", "b"]]); // b absent on its departure frame, present on re-add
    f.family.dispose();
  });

  it("contains a throwing listener — sibling fires; the throw is rethrown out-of-band", () => {
    // Capture the out-of-band rethrow instead of letting it crash the process, so the
    // fail-loud contract is asserted deterministically (not as an uncaught exception).
    const microtasks: Array<() => void> = [];
    vi.stubGlobal("queueMicrotask", (cb: () => void) => microtasks.push(cb));
    const f = makeFamily<number>(["a"], { seed: () => 0 });
    const sibling = vi.fn();
    f.family.subscribe(() => {
      throw new Error("listener boom");
    });
    f.family.subscribe(sibling);
    expect(() => f.emitState("a", 1)).not.toThrow(); // contained synchronously
    expect(sibling).toHaveBeenCalledTimes(1); // sibling isolated from the throw
    expect(microtasks).toHaveLength(1); // one out-of-band rethrow scheduled
    expect(() => microtasks[0]?.()).toThrow(/change listener threw/); // fail-loud
    vi.unstubAllGlobals();
    f.family.dispose();
  });
});

describe("reactiveFamily — dispose", () => {
  it("tears down the membership sub and every member (disposer + onEvict)", () => {
    const f = makeFamily<number>(["a", "b"], { seed: () => 0 });
    const onChange = vi.fn();
    f.family.subscribe(onChange);
    f.family.dispose();
    expect(f.disposed.sort()).toEqual(["a", "b"]);
    expect(f.evicted.sort()).toEqual(["a", "b"]);
    // After dispose, membership emits are inert (the source tap was released).
    onChange.mockClear();
    f.emitMembers(["a"]);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("derived.registry — the pull-face exit", () => {
  it("resolves each member's entry on demand from its cached state", () => {
    const f = makeFamily<string>(["a", "b"], { seed: (k) => `state-${k}` });
    const reg = derived.registry(f.family, (key, state) => ({
      key,
      state,
    }));
    expect(new Set(reg.members())).toEqual(new Set(["a", "b"]));
    expect(reg.has("a")).toBe(true);
    expect(reg.resolve("a")).toEqual({ key: "a", state: "state-a" });
    f.emitState("a", "connected");
    expect(reg.resolve("a")).toEqual({ key: "a", state: "connected" }); // reads live cache
    reg.dispose();
  });

  it("passes undefined state to the resolver for an unseeded member", () => {
    const f = makeFamily<number>(["a"]); // no seed
    const resolve = vi.fn((key: string, state: number | undefined) => ({
      key,
      state,
    }));
    const reg = derived.registry(f.family, resolve);
    expect(reg.resolve("a")).toEqual({ key: "a", state: undefined });
    reg.dispose();
  });

  it("throws when resolving a non-member (a defect, not an empty result)", () => {
    const f = makeFamily<number>(["a"], { seed: () => 0 });
    const reg = derived.registry(f.family, (key, state) => ({ key, state }));
    expect(() => reg.resolve("z")).toThrow(/non-member/);
    reg.dispose();
  });

  it("fires subscribe on family change and disposes the backing family", () => {
    const f = makeFamily<number>(["a"], { seed: () => 0 });
    const reg = derived.registry(f.family, (key, state) => ({ key, state }));
    const onChange = vi.fn();
    reg.subscribe(onChange);
    f.emitState("a", 1);
    expect(onChange).toHaveBeenCalledTimes(1);
    reg.dispose();
    expect(f.disposed).toContain("a"); // dispose() reached the family
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
