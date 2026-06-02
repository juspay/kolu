import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal, onCleanup } from "solid-js";
import { describe, expect, it } from "vitest";
import { useTerminalExits } from "./useTerminalExits";

const ids = (...xs: string[]) => xs as TerminalId[];
/** Solid flushes `createEffect` on a microtask; a macrotask tick drains it. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("useTerminalExits", () => {
  it("releases a terminal's exit subscription the moment it leaves the list", async () => {
    await createRoot(async (dispose) => {
      // A killed terminal publishes no `terminalExit` event, so its departure
      // from the list is the ONLY thing that can release the subscription —
      // the exact path that leaked before this was list-keyed.
      const live = new Set<string>();
      const [list, setList] = createSignal(ids("a", "b"));
      useTerminalExits({
        ids: list,
        subscribe: (id) => {
          live.add(id);
          onCleanup(() => live.delete(id));
        },
      });
      await flush();
      expect([...live].sort()).toEqual(["a", "b"]);

      setList(ids("a")); // "b" killed
      await flush();
      expect([...live]).toEqual(["a"]);

      setList(ids()); // killAll
      await flush();
      expect(live.size).toBe(0);

      dispose();
    });
  });

  it("subscribes each terminal exactly once and never re-subscribes survivors", async () => {
    await createRoot(async (dispose) => {
      const counts = new Map<string, number>();
      const [list, setList] = createSignal(ids());
      useTerminalExits({
        ids: list,
        subscribe: (id) => counts.set(id, (counts.get(id) ?? 0) + 1),
      });
      await flush();

      setList(ids("a"));
      await flush();
      setList(ids("a", "b")); // adding "b" must not re-run "a"
      await flush();

      expect(counts.get("a")).toBe(1);
      expect(counts.get("b")).toBe(1);

      dispose();
    });
  });
});
