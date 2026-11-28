/** The Code tab's SHOWN file — the stored pick judged against the retained
 *  tree inventory — driven over plain signals, the real derivation and not a
 *  replica.
 *
 *  Two things are the point. The pin: a direct read can prove a file the
 *  retained tree has not published yet, and the pin holds the shown file until
 *  it catches up, retiring on the frame it does. And the FRAME: the verdict is
 *  derived, so a file the landed inventory no longer lists stops being shown in
 *  the same pass that publishes those paths — never one flush later, with a
 *  dead file painted in between (`EFFECT_RELAY_TEAR`, which under
 *  `@kolu/solid-test-setup`'s attribution tier fails this file). Nothing here
 *  writes the selection: the stored slot keeps its pick. */

import type { CodeTabView } from "@kolu/padi-client/surface";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
} from "solid-js";
import { describe, expect, it } from "vitest";
import type { OpenInCodeTabRequest } from "./codeTabOpenController";
import {
  codeTabShownSelection,
  createCodeTabSelect,
} from "./codeTabSelectionReconcile";

const SLOT = "slot:local:/srv/code/kestrel:browse";

/** The request a terminal link made — identity is what a pin is addressed to,
 *  so one object per open is the whole of what this file needs from it. */
const REQUEST = {
  scope: {
    host: { kind: "local" },
    owner: "pane-1",
    repoRoot: "/srv/code/kestrel",
    mode: "browse",
  },
  ref: { path: "fresh.txt", startLine: null, endLine: null },
} as unknown as OpenInCodeTabRequest;

/** One painted frame: what a consumer reading BOTH the landed paths and the
 *  shown file was handed, recorded once per effect flush — the pair the tree
 *  is given (`FileTree paths` + `selectedPath`). */
interface PaintedFrame {
  paths: readonly string[];
  shown: string | null;
}

function harness(init: { selected: string | null; paths: string[] }) {
  const [selected, setSelected] = createSignal<string | null>(init.selected);
  const [paths, setPaths] = createSignal<string[]>(init.paths);
  const [pending, setPending] = createSignal(false);
  const [slot, setSlot] = createSignal<string | null>(SLOT);
  const [fresh, setFresh] = createSignal<{
    request: OpenInCodeTabRequest;
    path: string;
  } | null>(null);
  const [request, setRequest] = createSignal<OpenInCodeTabRequest | null>(null);
  const frames: PaintedFrame[] = [];
  let shown!: () => string | null;
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    shown = codeTabShownSelection({
      selectedPath: selected,
      repoSlotKey: slot,
      inventory: () => ({ paths: paths(), pending: pending() }),
      freshSelection: fresh,
      pendingRequest: request,
    });
    // The tree's own frame: the paths it is given and the row it is told to
    // select, minted together by one compute.
    const frame = createMemo(
      (): PaintedFrame => ({
        paths: paths(),
        shown: shown(),
      }),
    );
    createEffect(
      frame,
      (painted) => {
        frames.push(painted);
      },
      { name: "recordPaintedFrame" },
    );
  });
  return {
    selected,
    shown: () => shown(),
    fresh,
    frames,
    setSelected,
    setPaths,
    setPending,
    setSlot,
    setFresh,
    setRequest,
    dispose,
  };
}

describe("the Code tab's shown file", () => {
  it("retires the pin on the frame the retained inventory publishes the file", () => {
    const h = harness({ selected: "notes.txt", paths: ["notes.txt"] });
    flush();

    // The fresh read landed: the selection moved to a file the retained tree
    // does not list yet, pinned to the request that proved it.
    h.setRequest(REQUEST);
    h.setFresh({ request: REQUEST, path: "fresh.txt" });
    h.setSelected("fresh.txt");
    flush();
    expect(h.shown()).toBe("fresh.txt");

    // The retained tree catches up: the pin is spent, and the file stands.
    h.setPaths(["notes.txt", "fresh.txt"]);
    flush();
    expect(h.shown()).toBe("fresh.txt");

    // The normal removal rule is authoritative again — and the pin, still
    // addressed to the request the door holds, no longer holds the file.
    h.setPaths(["notes.txt"]);
    flush();
    expect(h.shown()).toBeNull();
    expect(h.fresh()).toEqual({ request: REQUEST, path: "fresh.txt" });
    // The stored slot kept its pick: the derivation writes nothing.
    expect(h.selected()).toBe("fresh.txt");
    h.dispose();
  });

  it("holds the pinned path through the stale window, and drops an unpinned missing file", () => {
    const h = harness({ selected: "fresh.txt", paths: ["notes.txt"] });
    h.setRequest(REQUEST);
    h.setFresh({ request: REQUEST, path: "fresh.txt" });
    flush();

    // Settled, missing, but pinned: held.
    h.setPaths(["notes.txt", "other.txt"]);
    flush();
    expect(h.shown()).toBe("fresh.txt");

    // A pin addressed to a request that is no longer pending gates nothing.
    h.setRequest(null);
    h.setPaths(["notes.txt"]);
    flush();
    expect(h.shown()).toBeNull();
    h.dispose();
  });

  it("does not judge the new slot's selection against the old slot's tree", () => {
    const h = harness({ selected: "notes.txt", paths: ["notes.txt"] });
    // One settled frame of this slot first: it is the frame that establishes
    // the slot the next one is judged against.
    h.setPaths(["notes.txt", "src/ledger.rs"]);
    flush();
    expect(h.shown()).toBe("notes.txt");

    // The repo slot moves and the previous repo's snapshot is still exposed:
    // the frame that sees both holds the pick rather than hiding it.
    h.setSlot("slot:local:/srv/code/other:browse");
    h.setSelected("elsewhere.rs");
    flush();
    expect(h.shown()).toBe("elsewhere.rs");

    // The new slot's own listing settles it from the next frame on.
    h.setPaths(["elsewhere.rs"]);
    flush();
    expect(h.shown()).toBe("elsewhere.rs");
    h.setPaths(["other.rs"]);
    flush();
    expect(h.shown()).toBeNull();
    h.dispose();
  });

  it("hides a dropped file in the landing's own frame, four landings running", () => {
    const h = harness({ selected: null, paths: [] });
    flush();

    // FOUR successive landings that each drop the shown file, driven before
    // anything is asserted: a relay tear escalates to `warn` on the third
    // sighting, so an assertion that stopped the drive at the first landing
    // would never reach the grade this file is written against.
    const landings: Array<{ pick: string; landed: string; frames: number }> =
      [];
    for (const [pick, landed] of [
      ["a.txt", "b.txt"],
      ["b.txt", "c.txt"],
      ["c.txt", "d.txt"],
      ["d.txt", "e.txt"],
    ] as ReadonlyArray<readonly [string, string]>) {
      h.setPaths([pick]);
      h.setSelected(pick);
      flush();
      const before = h.frames.length;
      h.setPaths([landed]);
      flush();
      landings.push({
        pick,
        landed,
        frames: h.frames.length - before,
      });
    }

    // ONE frame per landing, carrying the verdict already: not one painting
    // the dead file and a second correcting it. The slot keeps its pick —
    // nothing here writes the selection.
    expect(landings).toEqual([
      { pick: "a.txt", landed: "b.txt", frames: 1 },
      { pick: "b.txt", landed: "c.txt", frames: 1 },
      { pick: "c.txt", landed: "d.txt", frames: 1 },
      { pick: "d.txt", landed: "e.txt", frames: 1 },
    ]);
    expect(h.shown()).toBeNull();
    expect(h.selected()).toBe("d.txt");

    // Every frame the tree was ever handed names a file that frame's own paths
    // list — the dead-file frame never exists.
    expect(
      h.frames.filter((f) => f.shown !== null && !f.paths.includes(f.shown)),
    ).toEqual([]);
    h.dispose();
  });

  it("shows a condemned pick again when its file comes back, in that landing's own frame", () => {
    // The improvement the derivation hides: the stored slot keeps a condemned
    // pick, so the pick is re-judged on every frame and a file that RETURNS —
    // deleted then recreated in browse, committed then re-edited in Local — is
    // shown again with no user action. Master's reconcile wrote the clear, so
    // the slot was empty by then and the user got the select hint until they
    // picked the file a second time.
    const h = harness({
      selected: "obsolete.txt",
      paths: ["keep.txt", "obsolete.txt"],
    });
    flush();
    expect(h.shown()).toBe("obsolete.txt");

    // `rm obsolete.txt`: the settled listing drops it, so it stops being shown
    // — but the slot keeps the pick.
    h.setPaths(["keep.txt"]);
    flush();
    expect(h.shown()).toBeNull();
    expect(h.selected()).toBe("obsolete.txt");

    // It is recreated. One frame, carrying the file and the paths that list it.
    const before = h.frames.length;
    h.setPaths(["keep.txt", "obsolete.txt"]);
    flush();
    expect(h.shown()).toBe("obsolete.txt");
    expect(h.frames.length - before).toBe(1);
    expect(h.frames.at(-1)).toEqual({
      paths: ["keep.txt", "obsolete.txt"],
      shown: "obsolete.txt",
    });
    h.dispose();
  });
});

/** The grounded selection funnel. A write that lands on a file the settled
 *  inventory already dropped — a same-mode back/forward step onto it — is
 *  judged here, so the SLOT never seats a dead path. */
describe("the Code tab's selection funnel", () => {
  function selectHarness(init: { paths: string[]; pending?: boolean }) {
    const [paths] = createSignal<string[]>(init.paths);
    const [pending, setPending] = createSignal(init.pending ?? false);
    const seated: Array<{ mode: CodeTabView; path: string | null }> = [];
    const recorded: Array<{ mode: CodeTabView; path: string | null }> = [];
    const select = createCodeTabSelect({
      view: () => "browse",
      inventory: () => ({ paths: paths(), pending: pending() }),
      setSelectedFile: (mode, path) => seated.push({ mode, path }),
      recordNavigation: (loc) =>
        recorded.push({ mode: loc.mode, path: loc.path }),
    });
    return { select, seated, recorded, setPending };
  }

  it("clears a selection written to a missing path, with no inventory frame", () => {
    const h = selectHarness({ paths: ["notes.txt"] });

    // A back/forward step inside one mode, onto a file the settled inventory
    // has already dropped. Nothing moves the inventory, so the reconcile never
    // decides: the write itself must seat null.
    h.select("browse", "gone.txt", { record: false });
    expect(h.seated).toEqual([{ mode: "browse", path: null }]);

    // A file the inventory does list is seated as asked, and recorded.
    h.select("browse", "notes.txt");
    expect(h.seated.at(-1)).toEqual({ mode: "browse", path: "notes.txt" });
    expect(h.recorded).toEqual([{ mode: "browse", path: "notes.txt" }]);
  });

  it("seats a path a fresh read proved, and one the inventory has not settled", () => {
    const h = selectHarness({ paths: ["notes.txt"] });

    // The fresh read proved the file before the retained tree published it;
    // the pin minted alongside this write is not readable yet, so the proof
    // rides on the write.
    h.select("browse", "fresh.txt", { proven: true });
    expect(h.seated.at(-1)).toEqual({ mode: "browse", path: "fresh.txt" });

    // An unsettled inventory condemns nothing (the write reads the frame
    // standing at it, so let the new one land first).
    h.setPending(true);
    flush();
    h.select("browse", "gone.txt");
    expect(h.seated.at(-1)).toEqual({ mode: "browse", path: "gone.txt" });
  });

  it("leaves another mode's slot to the reconcile", () => {
    const h = selectHarness({ paths: ["notes.txt"] });

    // The tree menu's cross-mode jump writes before the switch, against an
    // inventory that is not that mode's.
    h.select("local", "gone.txt");
    expect(h.seated).toEqual([{ mode: "local", path: "gone.txt" }]);
  });
});
