/** `createKeyedRoot` (H1) — the ONE test surface for the keyed-root swap that kolu's
 *  host-scoped client subs (`bindingScoped`) and this provider's per-control-plane
 *  buildInfo cell both delegate to. It re-derives a value under a FRESH root per key
 *  change, disposing the prior root (no leak across the swap — the #1687 class), and is
 *  eager + synchronous (the value is present on the first read). */

import { createRoot, createSignal, onCleanup } from "solid-js";
import { describe, expect, it } from "vitest";
import { createKeyedRoot } from "./index";

describe("createKeyedRoot", () => {
  it("re-derives under a fresh root per key change, disposing the prior root", () => {
    createRoot((dispose) => {
      const log = { opened: [] as string[], disposed: [] as string[] };
      const [key, setKey] = createSignal("a");
      const value = createKeyedRoot(key, (k) => {
        log.opened.push(k);
        onCleanup(() => log.disposed.push(k)); // owned by THIS key's root
        return `built:${k}`;
      });

      // Eager + synchronous: built on the first read, nothing disposed yet.
      expect(value()).toBe("built:a");
      expect(log.opened).toEqual(["a"]);
      expect(log.disposed).toEqual([]);

      // Key change: the old root is torn down, a fresh one built.
      setKey("b");
      expect(value()).toBe("built:b");
      expect(log.opened).toEqual(["a", "b"]);
      expect(log.disposed).toEqual(["a"]); // the prior key's root disposed — no leak

      // Disposing the outer owner tears down the final key's root too.
      dispose();
      expect(log.disposed).toEqual(["a", "b"]);
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
});
