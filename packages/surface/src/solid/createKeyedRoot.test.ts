/**
 * `createKeyedRoot` — the keyed-root swap atom. The load-bearing pin is the
 * SYNCHRONOUS dispose ordering: on a key change the prior key's root is disposed
 * (its subscriptions abort) BEFORE anything reads the new key, which is what makes
 * a host/entry switch leak no root across the swap and raise no false error from
 * the outgoing socket's close. Reverting the eager `createRenderEffect` (making the
 * re-key lazy-on-read) fails the first test.
 */

import { createRoot, createSignal, onCleanup } from "solid-js";
import { describe, expect, it } from "vitest";
import { createKeyedRoot } from "./createKeyedRoot";

describe("createKeyedRoot", () => {
  it("re-derives under a fresh root per key change, disposing the prior root SYNCHRONOUSLY before the next read", () => {
    createRoot((dispose) => {
      const opened: string[] = [];
      const disposed: string[] = [];
      const [key, setKey] = createSignal("a");
      const value = createKeyedRoot(key, (k) => {
        opened.push(k);
        onCleanup(() => disposed.push(k));
        return `built:${k}`;
      });
      // Eager: the value is built synchronously at creation, present on first read.
      expect(opened).toEqual(["a"]);
      expect(value()).toBe("built:a");

      setKey("b");
      // SYNCHRONOUS: "a"'s root is disposed and "b" opened by the time setKey returns
      // — BEFORE we read value(). This ordering is the switch-abort guarantee.
      expect(disposed).toEqual(["a"]);
      expect(opened).toEqual(["a", "b"]);
      expect(value()).toBe("built:b");

      dispose();
      expect(disposed).toEqual(["a", "b"]); // the final key tears down with the owner
    });
  });

  it("populates synchronously — the value is present on the FIRST read (no undefined-first-render)", () => {
    createRoot((dispose) => {
      const [key] = createSignal(1);
      const value = createKeyedRoot(key, (k) => ({ n: k }));
      expect(value()).toEqual({ n: 1 });
      dispose();
    });
  });

  it("THROWS when called outside a reactive owner (documented contract, not a silent leak)", () => {
    const [key] = createSignal("a");
    expect(() => createKeyedRoot(key, (k) => k)).toThrow(/reactive owner/);
  });

  it("re-runs the factory on a KEY change, NOT when an incidental signal the factory read changes (identity-keyed)", () => {
    createRoot((dispose) => {
      let builds = 0;
      const [key, setKey] = createSignal("a");
      const [tick, setTick] = createSignal(0);
      const value = createKeyedRoot(key, (k) => {
        builds++;
        return `${k}:${tick()}`;
      });
      expect(builds).toBe(1);
      expect(value()).toBe("a:0");

      // A signal the factory read changing must NOT re-run the factory — the atom
      // keys on `key`, and the factory runs untracked (mapArray's per-item root).
      setTick(1);
      expect(builds).toBe(1);

      // A KEY change re-runs it, reading the current incidental value.
      setKey("b");
      expect(builds).toBe(2);
      expect(value()).toBe("b:1");
      dispose();
    });
  });
});
