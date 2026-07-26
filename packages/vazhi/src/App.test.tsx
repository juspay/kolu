import {
  type Forward,
  type ForwardLoss,
  type ForwardManager,
  targetKey,
} from "@kolu/port-forward";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { App } from "./App.tsx";

/** A forward map that opens instantly and never touches ssh or a socket — the
 *  seam `createForwards` exists for. */
function fakeManager(): {
  create: (opts: { onLost: (loss: ForwardLoss) => void }) => ForwardManager;
  /** Kill a live forward the way a dropped ssh connection would. */
  killFromOutside: (key: string) => void;
  disposed: () => boolean;
  cancelled: () => readonly string[];
} {
  const live = new Map<string, Forward>();
  const cancelled: string[] = [];
  let notify: ((loss: ForwardLoss) => void) | undefined;
  let gone = false;
  let nextPort = 61000;
  // The library owns what a key IS — a fake that spells it itself would drift
  // the moment the encoding changes (it did: the kind is part of the key now).
  const keyOf = targetKey;
  return {
    disposed: () => gone,
    cancelled: () => cancelled,
    killFromOutside: (key) => {
      const forward = live.get(key);
      if (forward === undefined) throw new Error(`nothing open for ${key}`);
      live.delete(key);
      notify?.({ forward, reason: "host dropped", kind: "gone" });
    },
    create: (opts) => {
      notify = opts.onLost;
      return {
        create: async (target) => {
          const key = keyOf(target);
          const existing = live.get(key);
          if (existing !== undefined) return existing;
          const forward: Forward = {
            key,
            target,
            localPort: nextPort++,
            createdAt: Date.now(),
            // vazhi attaches nothing per forward — its `M` is `undefined`.
            meta: undefined,
          };
          live.set(key, forward);
          return forward;
        },
        promote: (key) => {
          // vazhi has no per-forward fact to relabel; the verb exists for a
          // consumer that does (kolu's auto → pinned), so the fake answers
          // only that the key is live.
          const forward = live.get(key);
          if (forward === undefined) {
            throw new Error(`no forward named "${key}"`);
          }
          return forward;
        },
        cancel: async (key) => {
          if (!live.delete(key)) throw new Error(`no forward named "${key}"`);
          cancelled.push(key);
        },
        list: () => [...live.values()],
        dispose: async () => {
          gone = true;
          live.clear();
        },
      };
    },
  };
}

/** Let the component's async work and Ink's next frame land. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((done) => setTimeout(done, 0));
}

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

function plain(text: string): string {
  return text
    .replaceAll(new RegExp(`${ESC}\\]8;;[^${BEL}]*${BEL}`, "g"), "")
    .replaceAll(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");
}

function start(fake: ReturnType<typeof fakeManager>) {
  return render(<App hostname="pureintent" createForwards={fake.create} />);
}

describe("vazhi's screen", () => {
  it("adds a forward and says where it answers", async () => {
    const fake = fakeManager();
    const { stdin, lastFrame } = start(fake);

    stdin.write("a");
    await settle();
    stdin.write("pu-dev:5173\r");
    await settle();

    const text = plain(lastFrame() ?? "");
    expect(text).toContain("pu-dev:5173");
    expect(text).toContain("http://pureintent:61000");
  });

  it("says what went wrong when a target cannot be parsed, and opens nothing", async () => {
    const fake = fakeManager();
    const { stdin, lastFrame } = start(fake);

    stdin.write("a");
    await settle();
    stdin.write("not-a-target\r");
    await settle();

    const text = plain(lastFrame() ?? "");
    expect(text).toContain("is not a target");
    expect(text).toContain("nothing forwarded yet");
  });

  it("drops a forward that dies on its own and says why", async () => {
    const fake = fakeManager();
    const { stdin, lastFrame } = start(fake);

    stdin.write("a");
    await settle();
    stdin.write("pu-dev:5173\r");
    await settle();

    fake.killFromOutside("remote:pu-dev:5173");
    await settle();

    const text = plain(lastFrame() ?? "");
    expect(text).toContain("lost pu-dev:5173");
    expect(text).toContain("host dropped");
    expect(text).toContain("nothing forwarded yet");
  });

  it("cancels the selected forward with x", async () => {
    const fake = fakeManager();
    const { stdin, lastFrame } = start(fake);

    stdin.write("a");
    await settle();
    stdin.write("pu-dev:5173\r");
    await settle();
    stdin.write("x");
    await settle();

    expect(fake.cancelled()).toEqual(["remote:pu-dev:5173"]);
    expect(plain(lastFrame() ?? "")).toContain("nothing forwarded yet");
  });

  it("cancels the forward the highlight is on, not the one at its index", async () => {
    const fake = fakeManager();
    const { stdin } = start(fake);

    stdin.write("a");
    await settle();
    stdin.write("pu-dev:5173\r");
    await settle();
    stdin.write("a");
    await settle();
    stdin.write("zest:8080\r");
    await settle();

    // The selection is on zest (the one just added); move up to pu-dev, then
    // cancel. A stored index would have to be re-derived against whichever
    // list the cancel happened to read.
    stdin.write("k");
    await settle();
    stdin.write("x");
    await settle();

    expect(fake.cancelled()).toEqual(["remote:pu-dev:5173"]);
  });

  it("keeps cancelling once the selected forward has left the table", async () => {
    // The selection is a key, and the row it names can leave without anyone
    // pressing anything. Held as truth on its own it went on naming a forward
    // that was gone, and the next `x` answered "no forwards to cancel" over a
    // table with a live row still in it.
    const fake = fakeManager();
    const { stdin, lastFrame } = start(fake);

    stdin.write("a");
    await settle();
    stdin.write("pu-dev:5173\r");
    await settle();
    stdin.write("a");
    await settle();
    stdin.write("zest:8080\r");
    await settle();

    stdin.write("k");
    await settle();
    stdin.write("x");
    await settle();
    stdin.write("x");
    await settle();

    expect(fake.cancelled()).toEqual([
      "remote:pu-dev:5173",
      "remote:zest:8080",
    ]);
    expect(plain(lastFrame() ?? "")).not.toContain("no forwards to cancel");
  });

  it("tears every forward down before it lets the process end", async () => {
    const fake = fakeManager();
    const { stdin } = start(fake);

    stdin.write("a");
    await settle();
    stdin.write("pu-dev:5173\r");
    await settle();
    stdin.write("q");
    await settle();

    expect(fake.disposed()).toBe(true);
  });
});
