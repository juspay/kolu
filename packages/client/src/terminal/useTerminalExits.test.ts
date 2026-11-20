import type { TerminalId } from "kolu-common/surface";
import { createRoot, createSignal, onCleanup } from "solid-js";
import { describe, expect, it } from "vitest";
import { useTerminalExits } from "./useTerminalExits";

const ids = (...xs: string[]) => xs as TerminalId[];
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("useTerminalExits", () => {
  it("releases a terminal's exit subscription the moment it leaves the list", async () => {
    await createRoot(async (dispose) => {
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

      setList(ids("a"));
      await flush();
      expect([...live]).toEqual(["a"]);

      setList(ids());
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
      setList(ids("a", "b"));
      await flush();

      expect(counts.get("a")).toBe(1);
      expect(counts.get("b")).toBe(1);

      dispose();
    });
  });
});
