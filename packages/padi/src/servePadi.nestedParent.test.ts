/**
 * #2059 at the DOORS — the two facts that genuinely need a handler.
 *
 * The rule itself (self-edge, absent / parked / nested parent, non-leaf child) is
 * unit-tested against `requireFlatParentEdge` in `terminal-registry.test.ts`,
 * where it lives. What only a handler can show is that each wire door actually
 * RUNS it, and that a rejected `chrome.setParent` leaves the record unmutated.
 *
 * Every case here rejects BEFORE `spawnPty` is reached, so no PTY is started and
 * there is no spawn rejection to drain — the suite needs no timer.
 */

import type { TerminalId } from "@kolu/terminal-vocab/schema";
import { ORPCError } from "@orpc/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setDaemonProcessId } from "./koluRoot.ts";
import {
  __resetPadiSurfaceCtxForTest,
  noopPadiSurfaceCtxForTest,
  setPadiSurfaceCtx,
} from "./padiSurfaceCtx.ts";
import { caught, padiDeps, seedActive, snapshot } from "./servePadi.testlib.ts";
import {
  getTerminal,
  registerTerminal,
  terminalEntries,
  unregisterTerminal,
} from "./terminal-registry.ts";
import { LOCAL_LOCATION } from "./vocab.ts";

setDaemonProcessId("nested-parent-test-server");

const ROOT = "11111111-1111-4111-8111-111111111111" as TerminalId;
const CHILD = "22222222-2222-4222-8222-222222222222" as TerminalId;
const SIBLING = "33333333-3333-4333-8333-333333333333" as TerminalId;
const DORMANT = "44444444-4444-4444-8444-444444444444" as TerminalId;

type CreateHandler = (a: { input: { parentId?: string } }) => { id: string };
type SetParentHandler = (a: {
  input: { id: string; parentId: string | null };
}) => void;

/** ONE deps graph per case, with both handlers derived from it — so "which deps
 *  instance is this asserting against?" has an answer in the test's own text. */
let create: CreateHandler;
let setParent: SetParentHandler;

beforeEach(() => {
  setPadiSurfaceCtx(noopPadiSurfaceCtxForTest());
  const deps = padiDeps({
    stateRoot: "/tmp/padi-nested-parent-test-state-root",
  });
  const c = deps.procedures?.lifecycle?.create as CreateHandler | undefined;
  const s = deps.procedures?.chrome?.setParent as SetParentHandler | undefined;
  if (!c) throw new Error("padi deps must serve lifecycle.create");
  if (!s) throw new Error("padi deps must serve chrome.setParent");
  create = c;
  setParent = s;

  seedActive(ROOT);
  seedActive(CHILD, ROOT);
  seedActive(SIBLING);
});

afterEach(() => {
  for (const [id] of [...terminalEntries()]) unregisterTerminal(id);
  __resetPadiSurfaceCtxForTest();
});

describe("the wire doors run the parent-edge rule (#2059)", () => {
  it("lifecycle.create refuses a parent that is itself a split child", () => {
    const err = caught(() => create({ input: { parentId: CHILD } }));
    expect(err).toBeInstanceOf(ORPCError);
    const orpc = err as ORPCError<string, unknown>;
    expect(orpc.code).toBe("BAD_REQUEST");
    expect(orpc.message).toContain(CHILD);
    // The remediation names the ROOT tile to parent against instead.
    expect(orpc.message).toContain(ROOT);
  });

  it("chrome.setParent leaves the record UNMUTATED after a reject", () => {
    const err = caught(() =>
      setParent({ input: { id: SIBLING, parentId: CHILD } }),
    );
    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
    // The bad write must not land — the sibling stays top-level.
    expect(getTerminal(SIBLING)?.meta.parentId).toBeUndefined();
  });

  it("chrome.setParent refuses a DORMANT parent and leaves the child top-level", () => {
    // The door-level half of the sleeping hole: `chrome.setParent` runs
    // `requireMutableTerminal` on the SUBJECT only, so nothing but the shared
    // rule stands between a caller and a live pane hung off a tile whose body is
    // `DormantTileBody` — painted nowhere. `lifecycle.create` is covered one
    // layer up by `requireActiveTerminal`; this door is not.
    registerTerminal(DORMANT, {
      info: { id: DORMANT, pid: 1 },
      meta: {
        state: "sleeping",
        location: LOCAL_LOCATION,
        lastActivityAt: 1,
        sleptAt: 1,
      },
      snapshot: snapshot(),
    });

    const err = caught(() =>
      setParent({ input: { id: SIBLING, parentId: DORMANT } }),
    );
    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError<string, unknown>).code).toBe("BAD_REQUEST");
    expect(getTerminal(SIBLING)?.meta.parentId).toBeUndefined();
  });

  it("chrome.setParent still CLEARS a parent (null is always legal)", () => {
    setParent({ input: { id: CHILD, parentId: null } });
    expect(getTerminal(CHILD)?.meta.parentId).toBeUndefined();
  });
});
