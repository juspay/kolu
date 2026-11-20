import {
  composeTerminalMetadata,
  LOCAL_LOCATION,
  SavedTerminalSchema,
} from "@kolu/padi-client/surface";
import type { TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { Schema } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "../padiSurfaceCtx.ts";
import { terminalsDirtyChannel } from "../publisher.ts";
import {
  type ActiveTerminalProcess,
  getTerminal,
  registerTerminal,
  unregisterTerminal,
} from "../terminal-registry.ts";
import {
  commitSnapshot,
  installSnapshot,
  publishTerminalState,
  updateClientMetadata,
  updateMemory,
} from "./metadata.ts";

const ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const decodeSavedTerminal = Schema.decodeUnknownSync(SavedTerminalSchema);

function fakeTerminal(): ActiveTerminalProcess {
  return {
    info: { id: ID, pid: 0 },
    meta: {
      state: "active",
      location: LOCAL_LOCATION,
      lastActivityAt: 0,
      promptedAt: null,
    },
    snapshot: snapshot(),
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

function snapshot(): TerminalSnapshot {
  return {
    cwd: "/tmp",
    git: { kind: "none" },
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
  };
}

let dirtyCount: number;
let stopWatch: () => void;

async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
  const entry = fakeTerminal();
  registerTerminal(ID, entry);
  installSnapshot(ID);
  dirtyCount = 0;
  stopWatch = terminalsDirtyChannel.consume({
    onEvent: () => {
      dirtyCount += 1;
    },
    onError: () => {},
  });
  await settle();
});

afterEach(() => {
  stopWatch?.();
  unregisterTerminal(ID);
  __resetPadiSurfaceCtxForTest();
});

describe("metadata publish routing", () => {
  it("commitSnapshot does NOT fire terminals:dirty even when cwd changes (the fold's watch loop owns the autosave fence)", async () => {
    commitSnapshot(ID, { ...snapshot(), cwd: "/new/cwd" });
    await settle();
    expect(dirtyCount).toBe(0);
  });

  it("updateClientMetadata fires terminals:dirty (every client field is persisted)", async () => {
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    updateClientMetadata(entry, ID, (m) => {
      m.themeName = "dracula";
    });
    await settle();
    expect(dirtyCount).toBe(1);
  });

  it("commitSnapshot does NOT fire terminals:dirty (the live agent stream)", async () => {
    commitSnapshot(ID, {
      ...snapshot(),
      agent: {
        kind: "claude-code",
        state: "thinking",
        sessionId: "sess-A",
        model: null,
        summary: "tick",
        taskProgress: null,
        workflow: null,
        contextTokens: null,
        startedAt: null,
      },
    });
    await settle();
    expect(dirtyCount).toBe(0);
  });

  it("commitSnapshot called repeatedly stays silent (the firehose case)", async () => {
    for (let i = 0; i < 50; i += 1) {
      commitSnapshot(ID, {
        ...snapshot(),
        foreground: { name: "claude", title: `tick ${i}`, shell: false },
      });
    }
    await settle();
    expect(dirtyCount).toBe(0);
  });

  it("updateMemory does NOT fire terminals:dirty (the fold's watch loop owns the autosave fence)", async () => {
    updateMemory(
      ID,
      { lastActivityAt: 123, promptedAt: null },
      {
        kind: "exact",
        agent: {
          kind: "claude-code",
          sessionId: "sess-A",
          resumeRef: "sess-A",
        },
        argv: ["--model", "sonnet"],
      },
    );
    await settle();
    expect(dirtyCount).toBe(0);
  });

  it("updateMemory writes the whole target (never an absent-key `undefined`) so the saved record still decodes", () => {
    updateMemory(
      ID,
      { lastActivityAt: 123, promptedAt: null },
      { kind: "none" },
    );
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    expect(entry.meta.restoreTarget).toEqual({ kind: "none" });
    expect(() =>
      decodeSavedTerminal({
        ...composeTerminalMetadata(entry.meta, entry.snapshot),
        id: ID,
      }),
    ).not.toThrow();
  });

  it("publishTerminalState fires terminals:dirty (a lifecycle flip arms autosave)", async () => {
    publishTerminalState(ID);
    await settle();
    expect(dirtyCount).toBe(1);
  });

  it("type fence: an TerminalSnapshot commit cannot carry a remembered memory field", () => {
    commitSnapshot(ID, {
      cwd: "/tmp",
      git: { kind: "none" },
      pr: { kind: "pending" },
      agent: null,
      foreground: null,
      ports: { status: "unknown" },
      // @ts-expect-error
      lastActivityAt: 0,
    });
  });

  it("type fence: updateMemory cannot write a snapshot field", () => {
    updateMemory(
      ID,
      {
        lastActivityAt: 0,
        // @ts-expect-error
        cwd: "/tmp",
      },
      { kind: "none" },
    );
  });

  it("type fence: snapshot fields cannot be written through entry.meta (authored)", () => {
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    // @ts-expect-error
    entry.meta.cwd = "/x";
  });
});

function throwingTerminalsCtx(): ReturnType<typeof noopPadiSurfaceCtxForTest> {
  const base = noopPadiSurfaceCtxForTest();
  return {
    ...base,
    collections: new Proxy({} as never, {
      get: (_t, name) =>
        name === "terminals"
          ? {
              upsert: () => {
                throw new Error("terminals subscriber boom");
              },
              remove: () => {},
            }
          : (base.collections as Record<string, unknown>)[name as string],
    }),
  } as ReturnType<typeof noopPadiSurfaceCtxForTest>;
}

describe("commit seams guard the publish boundary (emit stays infallible)", () => {
  it("commitSnapshot: a throwing terminals subscriber does NOT propagate, and the snapshot is still committed", () => {
    __resetPadiSurfaceCtxForTest();
    setPadiSurfaceCtx(throwingTerminalsCtx());
    const accepted = { ...snapshot(), cwd: "/accepted-despite-throw" };
    expect(() => commitSnapshot(ID, accepted)).not.toThrow();
    expect(getTerminal(ID)?.snapshot.cwd).toBe("/accepted-despite-throw");
  });

  it("updateMemory: a throwing terminals subscriber does NOT propagate, and the memory is still committed", () => {
    __resetPadiSurfaceCtxForTest();
    setPadiSurfaceCtx(throwingTerminalsCtx());
    expect(() =>
      updateMemory(
        ID,
        { lastActivityAt: 77, promptedAt: null },
        { kind: "none" },
      ),
    ).not.toThrow();
    const meta = getTerminal(ID)?.meta;
    expect(meta?.lastActivityAt).toBe(77);
    expect(meta?.restoreTarget).toEqual({ kind: "none" });
  });
});
