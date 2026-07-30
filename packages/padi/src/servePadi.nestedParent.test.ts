/**
 * #2059 — nested `parentId` is refused at create and setParent.
 *
 * A split-of-a-split is live in the registry but never painted on the canvas.
 * Both write doors must fail loud with a typed BAD_REQUEST that names the root
 * ancestor so the caller can re-parent one level up. A one-level parent still
 * works (the existing split path).
 */

import type { TerminalId, TerminalSnapshot } from "@kolu/terminal-vocab/schema";
import { ORPCError } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDaemonProcessId } from "./koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "./padiSurfaceCtx.ts";
import {
  type ActiveTerminalProcess,
  getTerminal,
  registerTerminal,
  terminalEntries,
  unregisterTerminal,
} from "./terminal-registry.ts";
import { buildPadiSurfaceDeps } from "./servePadi.ts";
import { fakeEndpoint, stubLog } from "./servePadi.testlib.ts";
import { LOCAL_LOCATION } from "./vocab.ts";

setDaemonProcessId("nested-parent-test-server");

const ROOT = "11111111-1111-4111-8111-111111111111" as TerminalId;
const CHILD = "22222222-2222-4222-8222-222222222222" as TerminalId;
const SIBLING = "33333333-3333-4333-8333-333333333333" as TerminalId;

const snapshot = (): TerminalSnapshot => ({
  cwd: "/w",
  git: null,
  pr: { kind: "absent" },
  agent: null,
  foreground: null,
  ports: { status: "unknown" },
});

function seedActive(id: TerminalId, parentId?: string): void {
  registerTerminal(id, {
    info: { id, pid: 1 },
    meta: {
      state: "active",
      location: LOCAL_LOCATION,
      lastActivityAt: 1,
      ...(parentId !== undefined ? { parentId } : {}),
    },
    snapshot: snapshot(),
    handle: {} as ActiveTerminalProcess["handle"],
  });
}

function deps() {
  return buildPadiSurfaceDeps({
    endpoint: fakeEndpoint,
    log: stubLog,
    startedAt: 0,
    commit: "",
    lifetime: { kind: "forever" },
    stateRoot: "/tmp/padi-nested-parent-test-state-root",
  });
}

function createHandler() {
  const create = deps().procedures?.lifecycle?.create as
    | ((a: { input: { parentId?: string } }) => { id: string })
    | undefined;
  if (!create) throw new Error("padi deps must serve lifecycle.create");
  return create;
}

function setParentHandler() {
  const setParent = deps().procedures?.chrome?.setParent as
    | ((a: { input: { id: string; parentId: string | null } }) => void)
    | undefined;
  if (!setParent) throw new Error("padi deps must serve chrome.setParent");
  return setParent;
}

function caught(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (e) {
    return e;
  }
}

beforeEach(() => setPadiSurfaceCtx(noopPadiSurfaceCtxForTest()));

afterEach(async () => {
  // createTerminal's kaval-less spawn rejects on a later microtask — drain it
  // before wiping the registry so an unhandled rejection doesn't poison the
  // next case.
  await new Promise((r) => setTimeout(r, 0));
  for (const [id] of [...terminalEntries()]) unregisterTerminal(id);
  __resetPadiSurfaceCtxForTest();
});

describe("lifecycle.create — nested parentId refused (#2059)", () => {
  it("rejects parentId that is itself a split child (typed BAD_REQUEST, root named)", () => {
    seedActive(ROOT);
    seedActive(CHILD, ROOT);
    const create = createHandler();

    const err = caught(() => create({ input: { parentId: CHILD } }));
    expect(err).toBeInstanceOf(ORPCError);
    const orpc = err as ORPCError<string, unknown>;
    expect(orpc.code).toBe("BAD_REQUEST");
    expect(orpc.message).toContain(CHILD);
    expect(orpc.message).toContain(ROOT);
    expect(orpc.message.toLowerCase()).toMatch(/nested|root tile|re-?parent/i);
  });

  it("still accepts a one-level parent against a top-level tile", async () => {
    seedActive(ROOT);
    const create = createHandler();

    const info = create({ input: { parentId: ROOT } });
    expect(info.id).toBeTruthy();
    // The fresh terminal is parented at the root (one level only).
    expect(getTerminal(info.id as TerminalId)?.meta.parentId).toBe(ROOT);
  });
});

describe("chrome.setParent — nested parentId refused (#2059)", () => {
  beforeEach(() => {
    seedActive(ROOT);
    seedActive(CHILD, ROOT);
    seedActive(SIBLING);
  });

  it("rejects re-parenting onto a split child (typed BAD_REQUEST, root named)", () => {
    const setParent = setParentHandler();

    const err = caught(() =>
      setParent({ input: { id: SIBLING, parentId: CHILD } }),
    );
    expect(err).toBeInstanceOf(ORPCError);
    const orpc = err as ORPCError<string, unknown>;
    expect(orpc.code).toBe("BAD_REQUEST");
    expect(orpc.message).toContain(CHILD);
    expect(orpc.message).toContain(ROOT);
    // Sibling stays top-level — the bad write must not land.
    expect(getTerminal(SIBLING)?.meta.parentId).toBeUndefined();
  });

  it("still accepts a one-level parent against a top-level tile", () => {
    const setParent = setParentHandler();
    setParent({ input: { id: SIBLING, parentId: ROOT } });
    expect(getTerminal(SIBLING)?.meta.parentId).toBe(ROOT);
  });

  it("still allows clearing parent (null)", () => {
    const setParent = setParentHandler();
    setParent({ input: { id: CHILD, parentId: null } });
    expect(getTerminal(CHILD)?.meta.parentId).toBeUndefined();
  });

  it("rejects self-parent (typed BAD_REQUEST, terminal stays top-level)", () => {
    const setParent = setParentHandler();
    const err = caught(() =>
      setParent({ input: { id: SIBLING, parentId: SIBLING } }),
    );
    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
    expect(getTerminal(SIBLING)?.meta.parentId).toBeUndefined();
  });

  it("rejects re-parenting a non-leaf (would invent depth-2 under the new parent)", () => {
    // ROOT has CHILD; sliding ROOT under SIBLING would leave CHILD nested.
    const setParent = setParentHandler();
    const err = caught(() =>
      setParent({ input: { id: ROOT, parentId: SIBLING } }),
    );
    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
    expect((err as ORPCError<string, unknown>).message).toContain(CHILD);
    expect(getTerminal(ROOT)?.meta.parentId).toBeUndefined();
    expect(getTerminal(CHILD)?.meta.parentId).toBe(ROOT);
  });
});
