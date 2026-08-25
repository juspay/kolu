/**
 * Publish-routing + type-fence tests for the awareness/metadata write seam.
 *
 * W1.R1 collapsed the two per-half publishes into ONE composed publish onto padi's
 * `terminals` collection, but the `terminals:dirty` fence is unchanged: the fold's
 * two commit seams (`commitSnapshot`, `updateMemory`) NEVER fire `terminals:dirty`
 * — the fold's WATCH LOOP arms autosave itself, but only on a restore-relevant
 * VALUE change, so a bare snapshot/memory tick must stay silent. The
 * client/lifecycle seams (`updateClientMetadata`, `publishTerminalState`) DO fire
 * dirty. The type fences pin the structural guarantee that the split has ONE writer
 * per half:
 *   - an `TerminalSnapshot` commit can't carry a REMEMBERED memory field;
 *   - `updateMemory`'s `AgentMemory` can't carry an OBSERVED field;
 *   - `entry.meta` (now AUTHORED) names NO snapshot field — `entry.meta.cwd = x`
 *     is a compile error.
 */

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

const ID = "term-pub-test";

/** The exact decode `snapshotSession` (terminals.ts) runs over every composed
 *  record on each autosave — spelled here so the seam test below exercises the
 *  real disk-persist gate, not a paraphrase of it. */
const decodeSavedTerminal = Schema.decodeUnknownSync(SavedTerminalSchema);

/** A registry entry — AUTHORED half (`meta`, no snapshot field) + the OBSERVED
 *  half (`awareness`, the fold's whole-replace target), both on the one entry. */
function fakeTerminal(): ActiveTerminalProcess {
  return {
    info: { id: ID, pid: 0 },
    // The authored record now carries memory FLAT, so `lastActivityAt` rides
    // `meta` (it left the snapshot with the cutover).
    meta: { state: "active", location: LOCAL_LOCATION, lastActivityAt: 0 },
    snapshot: snapshot(),
    // Tests never touch the PTY handle; the publish path doesn't read it.
    handle: {} as ActiveTerminalProcess["handle"],
  };
}

/** The OBSERVED half — the producer's emit shape (no memory), rides the entry
 *  under the same id; the fold REPLACES it wholesale each frame. */
function snapshot(): TerminalSnapshot {
  return {
    cwd: "/tmp",
    git: null,
    pr: { kind: "pending" },
    agent: null,
    foreground: null,
    ports: { status: "unknown" },
  };
}

let dirtyCount: number;
let stopWatch: () => void;

/** Yield to the event loop so the channel's async iterator can receive queued
 *  publishes. The publisher pipeline is async end-to-end, so a synchronous read
 *  immediately after a mutator would see the pre-event count. Two `setImmediate`
 *  ticks cover both legs of the pipe. */
async function settle(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

beforeEach(async () => {
  // surface.ts is not imported here; supply a no-op padi ctx so the composed
  // publish path (padi's `terminals` collection + `urgency` cell) doesn't throw.
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
  // The commit seams key on id and land on `entry.snapshot` / `entry.meta`; the
  // composed publish reads the registry. Register the entry (carrying BOTH halves),
  // then fan its composed record out.
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
  // Let `consume`'s async IIFE reach its first `for await` before any publish.
  await settle();
});

afterEach(() => {
  stopWatch?.();
  // Dropping the entry drops its awareness too (one backing store now).
  unregisterTerminal(ID);
  __resetPadiSurfaceCtxForTest();
});

describe("metadata publish routing", () => {
  it("commitSnapshot does NOT fire terminals:dirty even when cwd changes (the fold's watch loop owns the autosave fence)", async () => {
    // `cwd` is restore-relevant, but the commit seam no longer arms autosave: the
    // fold's watch loop fires dirty on the restore-relevant VALUE change, so a
    // bare snapshot commit must stay silent.
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
        foreground: { name: "claude", title: `tick ${i}` },
      });
    }
    await settle();
    expect(dirtyCount).toBe(0);
  });

  it("updateMemory does NOT fire terminals:dirty (the fold's watch loop owns the autosave fence)", async () => {
    // The remembered facts ARE restore-relevant, but the fold's watch loop
    // already arms autosave on the restore-relevant value change, so firing here
    // too would double-arm — the memory write itself stays silent.
    updateMemory(
      ID,
      { lastActivityAt: 123, lastAgentCommand: "claude" },
      {
        kind: "exact",
        command: "claude",
        agent: { kind: "claude-code", sessionId: "sess-A" },
      },
    );
    await settle();
    expect(dirtyCount).toBe(0);
  });

  it("updateMemory leaves `lastAgentCommand` ABSENT when nothing is remembered, so the saved record still decodes", () => {
    // `lastAgentCommand` is an OPTIONAL KEY: absent ≡ "never ran a known agent".
    // A plain assignment of the absent memory field wrote the key PRESENT with
    // `undefined`, which `SavedTerminalSchema` rejects — and `snapshotSession`
    // decodes SYNCHRONOUSLY inside the autosave, so the throw took padi down the
    // first time an agent was detected in a terminal with no remembered launch
    // line (the agent indicator then froze/vanished in the browser).
    updateMemory(ID, { lastActivityAt: 123 }, { kind: "none" });
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    expect("lastAgentCommand" in entry.meta).toBe(false);
    // The real consumer: `snapshotSession`'s decode of the composed record.
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

  // Type-fence assertions — the structural guarantee that the firehose can't grow
  // back AND that each half has one writer. If any `@ts-expect-error` line starts
  // compiling, a fence is broken. Test runtime is irrelevant; the assertion is at
  // type check.
  it("type fence: an TerminalSnapshot commit cannot carry a remembered memory field", () => {
    commitSnapshot(ID, {
      cwd: "/tmp",
      git: null,
      pr: { kind: "pending" },
      agent: null,
      foreground: null,
      ports: { status: "unknown" },
      // @ts-expect-error — `lastActivityAt` is REMEMBERED memory, not snapshot.
      lastActivityAt: 0,
    });
  });

  it("type fence: updateMemory cannot write a snapshot field", () => {
    updateMemory(
      ID,
      {
        lastActivityAt: 0,
        // @ts-expect-error — `cwd` is OBSERVED, not remembered.
        cwd: "/tmp",
      },
      { kind: "none" },
    );
  });

  it("type fence: snapshot fields cannot be written through entry.meta (authored)", () => {
    const entry = getTerminal(ID) as ActiveTerminalProcess;
    // @ts-expect-error — `cwd` lives on the snapshot; entry.meta is AUTHORED.
    entry.meta.cwd = "/x";
  });
});

// A padi ctx whose `terminals` collection `upsert` THROWS — to prove the commit
// seams guard the composed publish at the boundary: a throwing subscriber must not
// propagate back into the producer's emit (which would freeze a sensor), and the
// accepted value must still land on the registry entry (no desync). Built off the
// no-op ctx, overriding only the `terminals` collection's `upsert`.
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
    // Swap the beforeEach no-op ctx for one whose composed upsert throws.
    __resetPadiSurfaceCtxForTest();
    setPadiSurfaceCtx(throwingTerminalsCtx());
    const accepted = { ...snapshot(), cwd: "/accepted-despite-throw" };
    // The producer advanced its baseline before calling emit; if this threw, the
    // sensor loop would freeze AND the fold would desync. It must not throw —
    expect(() => commitSnapshot(ID, accepted)).not.toThrow();
    // — and the accepted value is on the entry (the fold's commit) even though the
    // publish to subscribers failed (it self-heals on the next snapshot).
    expect(getTerminal(ID)?.snapshot.cwd).toBe("/accepted-despite-throw");
  });

  it("updateMemory: a throwing terminals subscriber does NOT propagate, and the memory is still committed", () => {
    __resetPadiSurfaceCtxForTest();
    setPadiSurfaceCtx(throwingTerminalsCtx());
    expect(() =>
      updateMemory(
        ID,
        { lastActivityAt: 77, lastAgentCommand: "claude" },
        { kind: "none" },
      ),
    ).not.toThrow();
    const meta = getTerminal(ID)?.meta;
    expect(meta?.lastActivityAt).toBe(77);
    expect(meta?.lastAgentCommand).toBe("claude");
  });
});
