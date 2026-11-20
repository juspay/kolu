import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import {
  EMPTY_MEMORY,
  MEMORY_BODY_CAP,
  MEMORY_TITLE_CAP,
  MEMORY_WHY_CAP,
  type Memory,
  type MemoryEntry,
  type MemoryProposal,
  MemoryRefused,
  MemorySchema,
  type MemoryText,
  memoryFile,
  memoryFullRefusal,
  memoryNeed,
  memoryTextRefusal,
  memoryUsed,
  memoryWhyRefusal,
  proposalTitle,
  readMemoryFile,
  sameMemory,
  tidyMemoryText,
} from "./conductorMemory.ts";

const text = (over: Partial<MemoryText> = {}): MemoryText => ({
  title: "Squash-merge on demo-app",
  about: "demo-app",
  body: "Always squash. The maintainer reads one commit per pull request.",
  ...over,
});

const entry = (id: string, over: Partial<MemoryText> = {}): MemoryEntry => ({
  id,
  ...text(over),
  by: "you",
  edited: false,
  at: "2025-11-03T10:00:00.000Z",
});

const proposal = (
  id: string,
  batch: string,
  title = "Never merge on a Friday",
): MemoryProposal => ({
  id,
  change: { kind: "add", ...text({ title }) },
  why: null,
  at: "2025-11-07T10:00:00.000Z",
  batch,
});

const memoryWith = (over: Partial<Memory>): Memory => ({
  ...EMPTY_MEMORY,
  ...over,
});

describe("what a memory may be", () => {
  it("takes a title, an about line and Markdown text", () => {
    expect(memoryTextRefusal(text())).toBeNull();
    expect(memoryTextRefusal(text({ about: null }))).toBeNull();
  });

  it("takes a title and a text at their caps, and refuses one character more, saying both numbers", () => {
    const title = "t".repeat(MEMORY_TITLE_CAP);
    const body = "b".repeat(MEMORY_BODY_CAP);
    expect(memoryTextRefusal(text({ title, body }))).toBeNull();
    expect(memoryTextRefusal(text({ title: `${title}t` }))).toMatchObject({
      kind: "too-long",
      why: "The title is 81 characters; it can be 80.",
    });
    expect(memoryTextRefusal(text({ body: `${body}b` }))).toMatchObject({
      kind: "too-long",
      why: "The text is 1,201 characters; it can be 1,200.",
    });
  });

  it("refuses an empty title, an empty text and a heading line in the text", () => {
    expect(memoryTextRefusal(text({ title: "" }))?.kind).toBe("invalid");
    expect(memoryTextRefusal(text({ body: "  \n " }))?.kind).toBe("invalid");
    expect(
      memoryTextRefusal(text({ body: "First.\n## Second\nmore" }))?.kind,
    ).toBe("invalid");
    expect(memoryTextRefusal(text({ body: "#hashtag is fine" }))).toBeNull();
  });

  it("refuses a reason past its cap", () => {
    expect(memoryWhyRefusal("w".repeat(MEMORY_WHY_CAP))).toBeNull();
    expect(memoryWhyRefusal("w".repeat(MEMORY_WHY_CAP + 1))?.why).toBe(
      "The reason is 201 characters; it can be 200.",
    );
  });

  it("trims what it stores and reads an empty about line as none", () => {
    expect(
      tidyMemoryText({ title: "  Title ", about: "  ", body: "\n\nText\n\n" }),
    ).toEqual({ title: "Title", about: null, body: "Text" });
  });

  it("measures titles and bodies, and says how much a full memory lacks", () => {
    expect(memoryUsed([text({ title: "ab", body: "cde" })])).toBe(5);
    expect(memoryFullRefusal(512, 380).why).toBe(
      "Memory is full: this needs 512 characters and 380 are left. Delete or shorten an entry first.",
    );
  });

  it("knows the same memory written with other case and spacing", () => {
    expect(
      sameMemory(
        text(),
        text({
          title: "squash-merge ON demo-app",
          body: "Always squash.\nThe maintainer reads one commit  per pull request.",
        }),
      ),
    ).toBe(true);
    expect(sameMemory(text(), text({ body: "Never squash." }))).toBe(false);
  });

  it("keeps its shape through the wire", () => {
    const memory = memoryWith({
      entries: [entry("m1")],
      proposals: [proposal("p2", "turn-4")],
      declined: [
        { change: { kind: "forget", entry: "m1" }, at: "2025-11-20T09:00:00Z" },
      ],
      next: 3,
    });
    const encoded = JSON.parse(
      JSON.stringify(Schema.encodeSync(MemorySchema)(memory)),
    );
    expect(Schema.decodeUnknownSync(MemorySchema)(encoded)).toEqual(memory);
  });
});

describe("memory in what needs you", () => {
  it("is nothing while no proposal waits", () => {
    expect(memoryNeed(memoryWith({ entries: [entry("m1")] }))).toBeNull();
  });

  it("is one item with the title when one proposal waits", () => {
    expect(
      memoryNeed(memoryWith({ proposals: [proposal("p1", "turn-1")] })),
    ).toEqual({
      identity: "turn-1",
      count: 1,
      title: "Never merge on a Friday",
    });
  });

  it("is one item counting a batch, with one identity for the whole turn", () => {
    const need = memoryNeed(
      memoryWith({
        proposals: [
          proposal("p1", "turn-1", "One"),
          proposal("p2", "turn-1", "Two"),
          proposal("p3", "turn-1", "Three"),
        ],
      }),
    );
    expect(need).toEqual({ identity: "turn-1", count: 3, title: null });
  });

  it("moves its identity only with a later turn's proposal", () => {
    const first = [proposal("p1", "turn-1"), proposal("p2", "turn-1")];
    const later = memoryNeed(
      memoryWith({ proposals: [...first, proposal("p3", "turn-2")] }),
    );
    expect(memoryNeed(memoryWith({ proposals: first }))?.identity).toBe(
      "turn-1",
    );
    expect(later).toEqual({ identity: "turn-2", count: 3, title: null });
  });

  it("names a forget by the entry it would forget", () => {
    const memory = memoryWith({
      entries: [entry("m1", { title: "Old host" })],
      proposals: [
        {
          ...proposal("p2", "turn-1"),
          change: { kind: "forget", entry: "m1" },
        },
      ],
    });
    expect(proposalTitle(memory, memory.proposals[0] as MemoryProposal)).toBe(
      "Old host",
    );
    expect(memoryNeed(memory)?.title).toBe("Old host");
  });
});

describe("the memory file", () => {
  it("reads back what it wrote", () => {
    const entries = [
      text(),
      text({
        title: "Never merge on a Friday",
        about: null,
        body: "Hand a green pull request over instead.\n\n- even a small one\n- even a `fix:`",
      }),
    ];
    const file = memoryFile(entries);
    expect(file).toBe(
      [
        "# kolu Conductor memory",
        "",
        "## Squash-merge on demo-app",
        "About: demo-app",
        "",
        "Always squash. The maintainer reads one commit per pull request.",
        "",
        "## Never merge on a Friday",
        "",
        "Hand a green pull request over instead.",
        "",
        "- even a small one",
        "- even a `fix:`",
        "",
      ].join("\n"),
    );
    expect(readMemoryFile(file)).toEqual(entries);
  });

  it("refuses a file with no memory in it, rather than reading it as empty", () => {
    for (const file of ["", "# kolu Conductor memory\n", "just some notes\n"]) {
      const read = readMemoryFile(file);
      expect(read).toBeInstanceOf(MemoryRefused);
    }
  });

  it("refuses the whole file when one memory holds a heading, naming it", () => {
    const read = readMemoryFile(
      "## Fine\n\nText.\n\n## Broken\n\nText.\n### Sub\nmore\n",
    );
    expect(read).toBeInstanceOf(MemoryRefused);
    expect((read as MemoryRefused).why).toMatch(/^"Broken", on line 5: /u);
  });

  it("refuses the whole file when one memory is too long", () => {
    const read = readMemoryFile(
      `## Fine\n\nText.\n\n## Long\n\n${"x".repeat(MEMORY_BODY_CAP + 1)}\n`,
    );
    expect((read as MemoryRefused).kind).toBe("too-long");
  });
});
