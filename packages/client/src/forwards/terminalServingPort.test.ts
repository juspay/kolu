/**
 * "Which terminal is serving this forwarded port?" — the join behind making a
 * forward row a link back to the thing that opened it.
 *
 * A forward row names a port and a door. What it could not do until now is take
 * you to the agent that started the server, which is the question a user
 * actually has when they see one ("what IS this?"). The scanner already knows —
 * it attributed the port to a process subtree — so this is a lookup, not a new
 * fact.
 *
 * Two rules carry over from PRT1 and both are load-bearing:
 *
 *  - **The unit is the TILE, not the pane.** A dev server almost always runs in
 *    a SPLIT, so the port is attributed to the split's own subtree — and sending
 *    someone to a pane rather than to the tile they can actually see was the
 *    exact bug that made the Ports section look empty on a live deployment.
 *  - **`unknown` is not `[]`.** A terminal whose scan has never landed must not
 *    be searched as though it serves nothing; it simply cannot answer.
 */

import { describe, expect, it } from "vitest";
import type { TerminalId } from "kolu-common/surface";
import {
  terminalServingPort,
  type ServingCandidate,
} from "./terminalServingPort";

const id = (s: string) => s as TerminalId;

const serving = (
  terminalId: string,
  ports: number[],
  parentId: string | null = null,
): ServingCandidate => ({
  id: id(terminalId),
  parentId: parentId === null ? null : id(parentId),
  ports: {
    status: "known",
    list: ports.map((port) => ({
      port,
      name: "node",
      scope: "loopback",
      family: "v4",
    })),
  },
});

const blind = (terminalId: string): ServingCandidate => ({
  id: id(terminalId),
  parentId: null,
  ports: { status: "unknown" },
});

describe("terminalServingPort", () => {
  it("finds the terminal whose subtree holds the port", () => {
    expect(
      terminalServingPort({
        port: 5173,
        terminals: [serving("a", [3000]), serving("b", [5173])],
      }),
    ).toBe(id("b"));
  });

  it("returns the TILE when the server runs in a split", () => {
    // The PRT1 lesson, as a lookup: a dev server almost always runs in a split,
    // and a link to the split's own id would point at a pane rather than at the
    // tile the user can see and click.
    expect(
      terminalServingPort({
        port: 5173,
        terminals: [serving("tile", []), serving("split", [5173], "tile")],
      }),
    ).toBe(id("tile"));
  });

  it("is undefined when nothing serves it", () => {
    // A ⌘K forward to a port outside every terminal's subtree, or one whose
    // server has died. The row must still render — it just has nowhere to send
    // you, and offering a dead link would be worse than offering none.
    expect(
      terminalServingPort({ port: 9229, terminals: [serving("a", [3000])] }),
    ).toBeUndefined();
  });

  it("does not search a terminal that has never been scanned", () => {
    // `unknown` is not `[]`. A blind terminal cannot answer, and treating its
    // silence as "does not serve this" is the same collapse the whole two-way
    // exists to prevent.
    expect(
      terminalServingPort({ port: 5173, terminals: [blind("a")] }),
    ).toBeUndefined();
  });

  it("prefers the FIRST match, deterministically, when two terminals claim it", () => {
    // Legitimate: two programs can bind one port on different addresses, and a
    // fork-inherited socket shows in several subtrees. Any answer is honest, but
    // it must be the SAME answer every render or the link would move under the
    // pointer.
    const terminals = [serving("a", [5173]), serving("b", [5173])];
    expect(terminalServingPort({ port: 5173, terminals })).toBe(id("a"));
    expect(terminalServingPort({ port: 5173, terminals })).toBe(id("a"));
  });

  it("is undefined for an empty fleet", () => {
    expect(terminalServingPort({ port: 5173, terminals: [] })).toBeUndefined();
  });
});

describe("the Inspector's trailing group — the surface that most needs the link", () => {
  // A port in "also forwarded on this host" is BY DEFINITION served by some
  // terminal other than the one being inspected (if the inspected tile served
  // it, it would be a port row instead). So "which terminal?" is the exact
  // question that group raises, and it was the one place with no answer.

  it("finds the OTHER tile serving an orphaned forward", () => {
    const rows = [serving("inspected", [3000]), serving("elsewhere", [9229])];
    expect(terminalServingPort({ port: 9229, terminals: rows })).toBe(
      id("elsewhere"),
    );
  });

  it("finds it through that tile's SPLIT, and returns the tile", () => {
    // The common shape twice over: the dev server is in a split, and it is a
    // split of a tile you are not looking at. A link to the split's own id
    // would point at a pane rather than at something the user can activate.
    const rows = [
      serving("inspected", [3000]),
      serving("elsewhere", []),
      serving("elsewhere-split", [9229], "elsewhere"),
    ];
    expect(terminalServingPort({ port: 9229, terminals: rows })).toBe(
      id("elsewhere"),
    );
  });

  it("has no answer for a ⌘K forward to a port nothing serves", () => {
    // Which is precisely why the row must render the number plainly rather than
    // as a link — the group still has to show the door so it can be cancelled.
    const rows = [serving("inspected", [3000])];
    expect(
      terminalServingPort({ port: 61000, terminals: rows }),
    ).toBeUndefined();
  });
});
