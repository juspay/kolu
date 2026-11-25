/** The Code tab's selection ↔ inventory reconcile (`CodeTab`'s only writer of
 *  the fresh-read pin), driven over plain signals — the real effect, not a
 *  replica.
 *
 *  The pin is the point: a direct read can prove a file the retained tree has
 *  not published yet, and the pin holds the selection until it catches up. The
 *  frame that catches up CONSUMES the pin, and that consumption must not be a
 *  reason to decide again — under `@kolu/solid-test-setup`'s attribution tier a
 *  tracked pin fails this file with `EFFECT_WRITES_OWN_SOURCE`. */

import type { CodeTabView } from "@kolu/padi-client/surface";
import { createRoot, createSignal, flush } from "solid-js";
import { describe, expect, it } from "vitest";
import type { OpenInCodeTabRequest } from "./codeTabOpenController";
import { createCodeTabSelectionReconcile } from "./codeTabSelectionReconcile";

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
  const cleared: CodeTabView[] = [];
  let dispose!: () => void;
  createRoot((d) => {
    dispose = d;
    createCodeTabSelectionReconcile({
      selectedPath: selected,
      repoSlotKey: slot,
      inventory: () => ({ paths: paths(), pending: pending() }),
      freshSelection: fresh,
      pendingRequest: request,
      view: () => "browse",
      consumeFreshSelection: () => setFresh(null),
      clearSelection: (mode) => {
        cleared.push(mode);
        setSelected(null);
      },
    });
  });
  return {
    selected,
    fresh,
    cleared,
    setSelected,
    setPaths,
    setPending,
    setSlot,
    setFresh,
    setRequest,
    dispose,
  };
}

describe("the Code tab's selection ↔ inventory reconcile", () => {
  it("consumes the pin on the frame the retained inventory publishes the file", () => {
    const h = harness({ selected: "notes.txt", paths: ["notes.txt"] });
    flush();

    // The fresh read landed: the selection moved to a file the retained tree
    // does not list yet, pinned to the request that proved it.
    h.setRequest(REQUEST);
    h.setFresh({ request: REQUEST, path: "fresh.txt" });
    h.setSelected("fresh.txt");
    flush();
    expect(h.selected()).toBe("fresh.txt");
    expect(h.cleared).toEqual([]);

    // The retained tree catches up: the pin is consumed, and the selection
    // stands.
    h.setPaths(["notes.txt", "fresh.txt"]);
    flush();
    expect(h.fresh()).toBeNull();
    expect(h.selected()).toBe("fresh.txt");
    expect(h.cleared).toEqual([]);

    // The normal removal rule is authoritative again.
    h.setPaths(["notes.txt"]);
    flush();
    expect(h.selected()).toBeNull();
    expect(h.cleared).toEqual(["browse"]);
    h.dispose();
  });

  it("holds the pinned path through the stale window, and clears an unpinned missing file", () => {
    const h = harness({ selected: "fresh.txt", paths: ["notes.txt"] });
    h.setRequest(REQUEST);
    h.setFresh({ request: REQUEST, path: "fresh.txt" });
    flush();

    // Settled, missing, but pinned: held.
    h.setPaths(["notes.txt", "other.txt"]);
    flush();
    expect(h.selected()).toBe("fresh.txt");

    // A pin addressed to a request that is no longer pending gates nothing.
    h.setRequest(null);
    h.setPaths(["notes.txt"]);
    flush();
    expect(h.selected()).toBeNull();
    h.dispose();
  });

  it("does not judge the new slot's selection against the old slot's tree", () => {
    const h = harness({ selected: "notes.txt", paths: ["notes.txt"] });
    // One settled frame of this slot first: the effect is deferred, so its
    // first run is the one that establishes the slot it is judging against.
    h.setPaths(["notes.txt", "src/ledger.rs"]);
    flush();
    expect(h.cleared).toEqual([]);

    // The repo slot moves and the previous repo's snapshot is still exposed:
    // the tick that sees both bails, rather than clearing the new selection.
    h.setSlot("slot:local:/srv/code/other:browse");
    h.setSelected("elsewhere.rs");
    flush();
    expect(h.selected()).toBe("elsewhere.rs");
    expect(h.cleared).toEqual([]);
    h.dispose();
  });
});
