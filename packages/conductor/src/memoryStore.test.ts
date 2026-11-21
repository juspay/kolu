import {
  EMPTY_MEMORY,
  MEMORY_BODY_CAP,
  MEMORY_CAP,
  MEMORY_DECLINED_KEPT,
  MEMORY_WAITING_CAP,
  type Memory,
  type MemoryChange,
  type MemoryRefusalKind,
  MemoryRefused,
  type MemoryText,
} from "kolu-common/conductorMemory";
import { describe, expect, it } from "vitest";
import { type MemoryStore, memoryStore } from "./memoryStore.ts";

interface Harness {
  readonly store: MemoryStore;
  readonly published: Array<Memory>;
  readonly scheduled: Array<string>;
  readonly taughtAgain: () => number;
}

const harness = (start: Memory = EMPTY_MEMORY): Harness => {
  const published: Array<Memory> = [];
  const scheduled: Array<string> = [];
  let entriesChanged = 0;
  const store = memoryStore({
    records: {
      schedule: (what) => scheduled.push(what),
      now: (what) => scheduled.push(what),
      flush: () => {},
    },
    publish: (memory) => published.push(memory),
    entriesChanged: () => {
      entriesChanged += 1;
    },
    now: () => new Date("2025-11-20T09:00:00.000Z"),
  });
  store.load(start);
  return { store, published, scheduled, taughtAgain: () => entriesChanged };
};

const text = (
  title: string,
  body = `${title}, in a sentence.`,
): MemoryText => ({
  title,
  about: null,
  body,
});

const add = (title: string, body?: string): MemoryChange => ({
  kind: "add",
  ...text(title, body),
});

const refusalOf = (act: () => unknown): MemoryRefusalKind => {
  try {
    act();
  } catch (err) {
    if (err instanceof MemoryRefused) return err.kind;
    throw err;
  }
  throw new Error("expected a refusal");
};

describe("a proposal", () => {
  it("waits on the human and is not memory", () => {
    const { store, taughtAgain } = harness();
    const proposal = store.propose(add("Squash-merge"), "you said so", "t1");
    expect(proposal).toMatchObject({
      id: "p1",
      why: "you said so",
      batch: "t1",
    });
    expect(store.read().entries).toEqual([]);
    expect(store.read().proposals).toEqual([proposal]);
    expect(taughtAgain()).toBe(0);
  });

  it("outside any turn is a batch of its own, so each rings once", () => {
    const { store } = harness();
    const first = store.propose(add("One"), null, null);
    const second = store.propose(add("Two"), null, null);
    expect(first.batch).toBe(first.id);
    expect(second.batch).toBe(second.id);
  });

  it("is refused for text that could not be a memory, and for a reason too long", () => {
    const { store } = harness();
    expect(refusalOf(() => store.propose(add(""), null, "t1"))).toBe("invalid");
    expect(
      refusalOf(() =>
        store.propose(add("Long", "x".repeat(MEMORY_BODY_CAP + 1)), null, "t1"),
      ),
    ).toBe("too-long");
    expect(
      refusalOf(() => store.propose(add("Fine"), "w".repeat(201), "t1")),
    ).toBe("too-long");
    expect(store.read().proposals).toEqual([]);
  });

  it("is refused when it is already remembered, already waiting, or was declined", () => {
    const { store } = harness();
    store.save(text("Never merge on a Friday"));
    expect(
      refusalOf(() =>
        store.propose(
          add(
            "never merge on a friday",
            "Never merge on a Friday, in a  sentence.",
          ),
          null,
          "t1",
        ),
      ),
    ).toBe("already-remembered");
    store.propose(add("Squash"), null, "t1");
    expect(refusalOf(() => store.propose(add("Squash"), null, "t2"))).toBe(
      "already-waiting",
    );
    const rebase = store.propose(add("Rebase"), null, "t1");
    store.decline(rebase.id);
    let why = "";
    try {
      store.propose(add("Rebase"), null, "t3");
    } catch (err) {
      why = (err as MemoryRefused).why;
    }
    expect(why).toBe(
      "The human declined this on 20 Nov. It is not remembered. Do not propose it again.",
    );
  });

  it("is refused past twenty waiting, and the twentieth is taken", () => {
    const { store } = harness();
    for (let n = 1; n <= MEMORY_WAITING_CAP; n += 1)
      store.propose(add(`Proposal ${n}`), null, "t1");
    expect(store.read().proposals).toHaveLength(MEMORY_WAITING_CAP);
    expect(refusalOf(() => store.propose(add("One more"), null, "t1"))).toBe(
      "too-many-waiting",
    );
  });

  it("is refused when it would not fit, with both numbers", () => {
    const { store } = harness();
    const body = "x".repeat(MEMORY_BODY_CAP - 10);
    let used = 0;
    let n = 0;
    while (used + 10 + body.length <= MEMORY_CAP - 100) {
      const title = `Entry ${String(n).padStart(4, "0")}`;
      store.save(text(title, body));
      used += title.length + body.length;
      n += 1;
    }
    const left = MEMORY_CAP - used;
    const big = add("Too big", "y".repeat(left));
    let why = "";
    try {
      store.propose(big, null, "t1");
    } catch (err) {
      why = (err as MemoryRefused).why;
    }
    expect(why).toBe(
      `Memory is full: this needs ${(left + 7).toLocaleString("en")} characters and ${left.toLocaleString("en")} are left. Delete or shorten an entry first.`,
    );
    const fits = add("Fits", "z".repeat(left - 4));
    expect(store.propose(fits, null, "t1").id).toMatch(/^p/u);
  });

  it("to replace or forget is refused for an entry that is not there", () => {
    const { store } = harness();
    expect(
      refusalOf(() =>
        store.propose({ kind: "forget", entry: "m9" }, null, "t1"),
      ),
    ).toBe("no-such-entry");
    expect(
      refusalOf(() =>
        store.propose(
          { kind: "replace", entry: "m9", ...text("X") },
          null,
          "t1",
        ),
      ),
    ).toBe("no-such-entry");
  });
});

describe("the human's choice", () => {
  it("remembers a proposal as written, as the Conductor's", () => {
    const { store, taughtAgain } = harness();
    const { id } = store.propose(add("Squash-merge"), null, "t1");
    expect(store.approve(id)).toBe("remembered");
    expect(store.read().proposals).toEqual([]);
    expect(store.read().entries).toEqual([
      {
        id: "m2",
        ...text("Squash-merge"),
        by: "conductor",
        edited: false,
        at: "2025-11-20T09:00:00.000Z",
      },
    ]);
    expect(taughtAgain()).toBe(1);
  });

  it("remembers what the human wrote over a proposal, as edited", () => {
    const { store } = harness();
    const { id } = store.propose(add("Squash-merge"), null, "t1");
    expect(store.approve(id, text("Squash-merge on demo-app"))).toBe("edited");
    expect(store.read().entries[0]).toMatchObject({
      title: "Squash-merge on demo-app",
      by: "conductor",
      edited: true,
    });
  });

  it("replaces the entry a replace names, and adds it anew when that entry is gone", () => {
    const { store } = harness();
    const kept = store.save(text("Host", "demo-app is on local."));
    const gone = store.save(text("Old", "Old words."));
    const one = store.propose(
      {
        kind: "replace",
        entry: kept.id,
        ...text("Host", "demo-app is on demo@example."),
      },
      null,
      "t1",
    );
    const two = store.propose(
      { kind: "replace", entry: gone.id, ...text("Old", "New words.") },
      null,
      "t1",
    );
    store.remove(gone.id);
    store.approve(one.id);
    store.approve(two.id);
    expect(store.read().entries.map((entry) => [entry.id, entry.body])).toEqual(
      [
        [kept.id, "demo-app is on demo@example."],
        ["m5", "New words."],
      ],
    );
  });

  it("forgets the entry a forget names, and settles it when that entry is gone", () => {
    const { store, taughtAgain } = harness();
    const entry = store.save(text("Old host"));
    const first = store.propose(
      { kind: "forget", entry: entry.id },
      null,
      "t1",
    );
    const second = store.propose(add("Something else"), null, "t1");
    expect(store.approve(first.id)).toBe("forgotten");
    expect(store.read().entries).toEqual([]);
    expect(taughtAgain()).toBe(2);
    const again = store.save(text("Another"));
    const forget = store.propose(
      { kind: "forget", entry: again.id },
      null,
      "t2",
    );
    store.remove(again.id);
    const before = taughtAgain();
    expect(store.approve(forget.id)).toBe("forgotten");
    expect(taughtAgain()).toBe(before);
    expect(store.read().proposals.map((one) => one.id)).toEqual([second.id]);
  });

  it("declines without changing the entries, keeping the last fifty declined", () => {
    const { store, taughtAgain } = harness();
    for (let n = 0; n < MEMORY_DECLINED_KEPT + 1; n += 1) {
      const { id } = store.propose(add(`No ${n}`), null, "t1");
      store.decline(id);
    }
    expect(store.read().entries).toEqual([]);
    expect(store.read().declined).toHaveLength(MEMORY_DECLINED_KEPT);
    expect(store.read().declined[0]?.change).toMatchObject({ title: "No 1" });
    expect(taughtAgain()).toBe(0);
  });

  it("is refused for a proposal that was settled already", () => {
    const { store } = harness();
    const { id } = store.propose(add("Once"), null, "t1");
    store.approve(id);
    expect(refusalOf(() => store.approve(id))).toBe("no-such-proposal");
    expect(refusalOf(() => store.decline(id))).toBe("no-such-proposal");
  });

  it("refuses an approval that would no longer fit, and keeps the proposal waiting", () => {
    const body = "x".repeat(MEMORY_BODY_CAP);
    const entries = Array.from({ length: 13 }, (_, n) => ({
      id: `m${n + 1}`,
      title: `E${n}`,
      about: null,
      body,
      by: "you" as const,
      edited: false,
      at: "2025-11-01T00:00:00.000Z",
    }));
    const { store } = harness({ ...EMPTY_MEMORY, entries, next: 14 });
    const { id } = store.propose(add("Late", "y".repeat(300)), null, "t1");
    store.save(
      text("Filler", "f".repeat(MEMORY_CAP - 13 * (body.length + 3) - 6 - 100)),
    );
    expect(refusalOf(() => store.approve(id))).toBe("full");
    expect(store.read().proposals.map((one) => one.id)).toEqual([id]);
  });
});

describe("the human's own hand", () => {
  it("adds, edits and deletes, telling the Conductor each time", () => {
    const { store, taughtAgain, scheduled } = harness();
    const entry = store.save(text("Never merge on a Friday"));
    expect(entry).toMatchObject({ id: "m1", by: "you", edited: false });
    store.save(
      text("Never merge on a Friday", "Not even a small one."),
      entry.id,
    );
    expect(store.read().entries[0]).toMatchObject({
      body: "Not even a small one.",
      by: "you",
      edited: false,
    });
    store.remove(entry.id);
    expect(store.read().entries).toEqual([]);
    expect(taughtAgain()).toBe(3);
    expect(scheduled).toEqual(["memory", "memory", "memory"]);
  });

  it("marks the Conductor's entry as edited by the human", () => {
    const { store } = harness();
    const { id } = store.propose(add("Squash"), null, "t1");
    store.approve(id);
    const [entry] = store.read().entries;
    store.save(text("Squash", "Always squash."), entry?.id);
    expect(store.read().entries[0]).toMatchObject({
      by: "conductor",
      edited: true,
    });
  });

  it("is refused for an entry that is not there, or one already remembered", () => {
    const { store } = harness();
    store.save(text("One"));
    expect(refusalOf(() => store.save(text("Two"), "m7"))).toBe(
      "no-such-entry",
    );
    expect(refusalOf(() => store.remove("m7"))).toBe("no-such-entry");
    expect(
      refusalOf(() => store.save(text("one", "One, in a sentence."))),
    ).toBe("already-remembered");
  });
});

describe("the ids", () => {
  it("are never given out twice, whichever verb mints them", () => {
    const { store } = harness();
    const { id } = store.propose(add("Approved"), null, "t1");
    store.approve(id);
    store.save(text("Saved"));
    store.importEntries([text("Imported one"), text("Imported two")]);
    store.save(text("Saved again"));
    const ids = store.read().entries.map((entry) => entry.id);
    expect(ids).toEqual(["m2", "m3", "m4", "m5", "m6"]);
  });
});

describe("an import", () => {
  it("adds what is new, counts what is already there, and deletes nothing", () => {
    const { store, taughtAgain } = harness();
    store.save(text("Kept"));
    const imported = store.importEntries([
      text("Kept"),
      text("New one"),
      text("New one"),
      text("Another"),
    ]);
    expect(imported).toEqual({ added: 2, already: 2 });
    expect(store.read().entries.map((entry) => entry.title)).toEqual([
      "Kept",
      "New one",
      "Another",
    ]);
    expect(taughtAgain()).toBe(2);
  });

  it("is refused whole when it would pass the cap", () => {
    const { store } = harness();
    const body = "x".repeat(MEMORY_BODY_CAP);
    const texts = Array.from({ length: 14 }, (_, n) => text(`I${n}`, body));
    expect(refusalOf(() => store.importEntries(texts))).toBe("full");
    expect(store.read().entries).toEqual([]);
  });

  it("that adds nothing changes nothing", () => {
    const { store, published, taughtAgain } = harness();
    store.save(text("Kept"));
    const before = published.length;
    expect(store.importEntries([text("Kept")])).toEqual({
      added: 0,
      already: 1,
    });
    expect(published).toHaveLength(before);
    expect(taughtAgain()).toBe(1);
  });
});

describe("a restored backup", () => {
  it("replaces the whole record, and tells the Conductor when the entries moved", () => {
    const { store, taughtAgain } = harness();
    store.save(text("Before"));
    const restored: Memory = {
      ...EMPTY_MEMORY,
      entries: [
        {
          id: "m4",
          ...text("Restored"),
          by: "you",
          edited: false,
          at: "2025-11-01T00:00:00.000Z",
        },
      ],
      next: 5,
    };
    store.restore(restored);
    expect(store.read()).toEqual(restored);
    expect(taughtAgain()).toBe(2);
    expect(store.save(text("After")).id).toBe("m5");
  });
});
