import { Effect } from "effect";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  flush,
} from "solid-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

// useRightPanel reads `preferences()` and writes via `updatePreferences` from
// the wire singleton, resolves the active terminal from useTerminalStore, and
// gates `hasTerminals` on the tile registry's count. Stub all three so the size
// mutators can be exercised without a live socket (mocking useTileStore also
// keeps its persistCanvasLayout → solid-sonner chain out of the test env).
const h = vi.hoisted(() => ({
  host: "host-A",
  saveOnOtherHost: vi.fn((): Effect.Effect<void, Error> => Effect.void),
  updatePreferences: vi.fn(),
  // The record the last report carried, with its selection map copied leaf by
  // leaf, or `undefined` when the report carried no map at all.
  decoded: undefined as
    | { selectedFileByMode?: Record<string, string> }
    | undefined,
  // The REAL `chrome.setRightPanel` decodes its input at the edge
  // (`@kolu/surface`'s unary dispatch: `decode(input)`), walking the record's
  // leaves SYNCHRONOUSLY, in whatever phase the write was made from. A report
  // that carries the store's own `selectedFileByMode` therefore reads a store
  // leaf inside an effect's apply arm — STRICT_READ_UNTRACKED. This stand-in
  // walks the same leaves, so the test harness sees what the wire would.
  setRightPanel: vi.fn(
    (input: {
      selectedFileByMode?: Record<string, string>;
    }): Effect.Effect<void, Error> => {
      h.decoded =
        input.selectedFileByMode === undefined
          ? {}
          : { selectedFileByMode: { ...input.selectedFileByMode } };
      return Effect.void;
    },
  ),
  toastError: vi.fn(),
  prefs: {
    newTerminalCollapsed: false,
    rightPanel: { size: 0.25, codeTabTreeSize: 0.35 },
  },
  // Mutable so a test can flip the "active terminal" the way the workspace
  // switcher does at runtime — `recordNavigation`/`canNavigateBack` resolve
  // their terminal through this.
  activeId: null as string | null,
  // The FOCUSED PANE, when it is not the active tile (i.e. a split has focus).
  // `undefined` means "no split focused" — the focused-pane reads then fall back
  // to `activeId`, which is the main pane of the active tile. A split test sets
  // this to a distinct id.
  focusedId: undefined as string | null | undefined,
  // What `getMetadata` answers with — `undefined` for every terminal by default,
  // so only a test that pins a creator-passed `rightPanel` sees one.
  metadata: undefined as
    | { rightPanel?: RightPanelPerTerminalState; git?: GitFact }
    | undefined,
}));

vi.mock("../wire", () => ({
  // `reportToServer` writes via `activePadiRpc.chrome.setRightPanel`
  // (the active host's padi client) — the per-terminal collapsed/tab report path.
  activePadiRpc: {
    chrome: {
      get setRightPanel() {
        return h.host === "host-A" ? h.setRightPanel : h.saveOnOtherHost;
      },
    },
  },
  activeHost: () => h.host,
  padiRpcOf: (host: string) => ({
    chrome: {
      setRightPanel: host === "host-A" ? h.setRightPanel : h.saveOnOtherHost,
    },
  }),
  updatePreferences: h.updatePreferences,
  preferences: () => h.prefs,
}));

// A rejected `setRightPanel` (an application-level RPC failure on an otherwise
// live padi) must surface, not silently revert on reload — see `reportToServer`.
vi.mock("solid-sonner", () => ({ toast: { error: h.toastError } }));

// The two focus facts are SIGNALS, not plain fields: the panel mirrors the
// focused pane into a plain field through a standing computation
// (`focusedPlace`), which is what its write-only verbs (`setSelectedFile`,
// `recordNavigation`) consult instead of reading the store from the effect
// phase — and a plain field would never notify that computation. `h.activeId =
// x` / `h.focusedId = x` stay the way a test says "focus is there now": the
// setters write the signal and `flush()` it, so the mirror has caught up by the
// next line exactly as it did when these were fields.
vi.mock("../terminal/useTerminalStore", async () => {
  // Imported HERE, not at the top: a `vi.mock` factory is hoisted above every
  // static import in this file, so a top-level binding is in its TDZ when this
  // runs (the same reason `hostCodeTab.test.ts` imports inside its factories).
  const { createSignal, flush } = await import("solid-js");
  const [activeId, setActiveId] = createSignal<string | null>(null);
  const [focusedId, setFocusedId] = createSignal<string | null | undefined>(
    undefined,
  );
  Object.defineProperty(h, "activeId", {
    get: activeId,
    set: (value: string | null) => {
      setActiveId(() => value);
      flush();
    },
    configurable: true,
  });
  Object.defineProperty(h, "focusedId", {
    get: focusedId,
    set: (value: string | null | undefined) => {
      setFocusedId(() => value);
      flush();
    },
    configurable: true,
  });
  return {
    useTerminalStore: () => ({
      activeId,
      // Falls back to the active tile (= its main pane) unless a test focuses a
      // split — so every pre-split test keeps reading tile === pane.
      focusedTerminalId: () => focusedId() ?? activeId(),
      getMetadata: () => h.metadata,
    }),
  };
});

vi.mock("../tile/useTileStore", () => ({
  useTileStore: () => ({ tileCount: () => (h.activeId ? 1 : 0) }),
}));

import type { RightPanelPerTerminalState } from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";
import type { GitFact } from "@kolu/terminal-vocab/schema";
import { useRightPanel } from "./useRightPanel";

beforeEach(() => {
  h.host = "host-A";
  h.saveOnOtherHost.mockClear();
  h.updatePreferences.mockClear();
  h.setRightPanel.mockClear();
  h.toastError.mockClear();
  h.decoded = undefined;
  h.activeId = null;
  h.focusedId = undefined;
  h.metadata = undefined;
  h.prefs = {
    newTerminalCollapsed: false,
    rightPanel: { size: 0.25, codeTabTreeSize: 0.35 },
  };
});

describe("useRightPanel — size writes drop Corvu's idempotent re-emits (#1041)", () => {
  it("setPanelSize drops a write equal to the stored size", () => {
    useRightPanel().setPanelSize(0.25);
    expect(h.updatePreferences).not.toHaveBeenCalled();
  });

  it("setPanelSize persists a changed size, opting into coalescing", () => {
    useRightPanel().setPanelSize(0.5);
    expect(h.updatePreferences).toHaveBeenCalledExactlyOnceWith(
      { rightPanel: { size: 0.5 } },
      { coalesce: true },
    );
  });

  it("setPanelSize ignores sizes at or below the minimum", () => {
    useRightPanel().setPanelSize(0.01);
    expect(h.updatePreferences).not.toHaveBeenCalled();
  });

  it("setCodeTabTreeSize drops a write equal to the stored value", () => {
    useRightPanel().setCodeTabTreeSize(0.35);
    expect(h.updatePreferences).not.toHaveBeenCalled();
  });

  it("setCodeTabTreeSize persists a changed value within bounds, opting into coalescing", () => {
    useRightPanel().setCodeTabTreeSize(0.6);
    expect(h.updatePreferences).toHaveBeenCalledExactlyOnceWith(
      { rightPanel: { codeTabTreeSize: 0.6 } },
      { coalesce: true },
    );
  });

  it("setCodeTabTreeSize ignores out-of-bounds values", () => {
    useRightPanel().setCodeTabTreeSize(0.95);
    expect(h.updatePreferences).not.toHaveBeenCalled();
  });
});

// `collapsed` lives on the per-terminal `TerminalMetadata.rightPanel` record
// (#959), but it is the TILE's bit: each tile remembers whether its panel was
// showing, restored on session restore like the active tab. A toggle reports via
// `chrome.setRightPanel` (server-persisted), NEVER `updatePreferences`. The
// module-level `perTerminal` store persists across `useRightPanel()` calls, so
// each test uses distinct terminal ids.
describe("useRightPanel — collapsed is per-TILE (posture follows the tile)", () => {
  it("a toggle reports the active terminal's collapsed via setRightPanel, not preferences", () => {
    const a = "collapse-A" as TerminalId;
    h.activeId = a;
    const rp = useRightPanel();
    expect(rp.collapsed()).toBe(false); // a fresh terminal defaults open
    rp.togglePanel();
    // The toggle's store write is staged: the panel paints it on the next flush.
    flush();
    expect(rp.collapsed()).toBe(true);
    expect(h.updatePreferences).not.toHaveBeenCalled();
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: a, collapsed: true }),
    );
  });

  it("each terminal remembers its own collapsed across an active-terminal switch", () => {
    const a = "collapse-switch-A" as TerminalId;
    const b = "collapse-switch-B" as TerminalId;
    const rp = useRightPanel();
    // Collapse A, leave B at its default (open).
    h.activeId = a;
    rp.collapsePanel();
    flush();
    expect(rp.collapsed()).toBe(true);
    // Switch to B — it reads its OWN default (open), not A's collapse.
    h.activeId = b;
    expect(rp.collapsed()).toBe(false);
    // Back to A — A's collapse is restored.
    h.activeId = a;
    expect(rp.collapsed()).toBe(true);
  });

  it("a collapse is a no-op with no active terminal (empty workspace)", () => {
    h.activeId = null;
    const rp = useRightPanel();
    rp.collapsePanel();
    expect(h.setRightPanel).not.toHaveBeenCalled();
    expect(rp.collapsed()).toBe(false); // floors to the open default
  });

  it("surfaces a failed setRightPanel via toast (dedup id), not a silent DevTools log", async () => {
    h.activeId = "collapse-fail" as TerminalId;
    h.setRightPanel.mockImplementationOnce(() =>
      Effect.fail(new Error("padi rejected")),
    );
    const rp = useRightPanel();
    rp.togglePanel(); // optimistic state flips, the report fails
    // The recovery runs on the report's own fiber; let it settle.
    await Promise.resolve();
    expect(h.toastError).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("padi rejected"),
      { id: "right-panel-report-failed" },
    );
  });

  it("a fresh terminal inherits the new-terminal default, then owns its own state", () => {
    // Pin the new-terminal default to collapsed.
    h.prefs = {
      newTerminalCollapsed: true,
      rightPanel: { size: 0.25, codeTabTreeSize: 0.35 },
    };
    const a = "collapse-seed-A" as TerminalId;
    h.activeId = a;
    const rp = useRightPanel();
    // No per-terminal record yet → reads the new-terminal default (collapsed).
    expect(rp.collapsed()).toBe(true);
    // Expanding writes the terminal's OWN record; the global preference is
    // never touched (a toggle is per-terminal, not a preference change).
    rp.expandPanel();
    flush();
    expect(rp.collapsed()).toBe(false);
    expect(h.updatePreferences).not.toHaveBeenCalled();
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: a, collapsed: false }),
    );
  });
});

// The panel's SUBJECT is the focused pane, not the active tile: `collapsed`
// stays on the TILE while activeTab / codeMode / selectedFile / history follow
// the PANE (main or any split). Same module-level `perTerminal`, so distinct
// ids per test.
describe("useRightPanel — the panel follows the focused pane", () => {
  it("collapsed stays on the tile while the active tab follows the pane", () => {
    const tile = "fp-tile" as TerminalId;
    const split = "fp-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    // Move focus to the split and put IT on the Inspector tab.
    h.focusedId = split;
    rp.showInspector();
    flush();
    expect(rp.activeTab()).toEqual({ kind: "inspector" });
    // Focus back to main — main's own default (Code) tab returns, and the
    // panel's posture (the TILE's) never moved.
    h.focusedId = undefined;
    expect(rp.activeTab().kind).toBe("code");
    expect(rp.collapsed()).toBe(false);
    // Focus the split again: ITS Inspector tab is restored, same posture.
    h.focusedId = split;
    expect(rp.activeTab().kind).toBe("inspector");
    expect(rp.collapsed()).toBe(false);
  });

  it("a bare repository's folder is browse-only, and the stored mode returns in a working tree", () => {
    const tile = "fp-bare-tile" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    rp.showCode("local");
    flush();
    const info = {
      repoRoot: "/proj",
      repoName: "proj",
      worktreePath: "/proj",
      branch: "master",
      isWorktree: false,
      mainRepoRoot: "/proj",
      remoteUrl: null,
    };
    // No working tree: nothing to diff, so the Code tab browses.
    h.metadata = { git: { kind: "repo", info: { ...info, isBare: true } } };
    expect(rp.code.codeMode()).toBe("browse");
    expect(rp.activeTab()).toEqual({ kind: "code", mode: "browse" });
    // Into a checkout: the mode the user picked is still theirs.
    h.metadata = { git: { kind: "repo", info: { ...info, isBare: false } } };
    expect(rp.code.codeMode()).toBe("local");
    expect(rp.activeTab()).toEqual({ kind: "code", mode: "local" });
  });

  it("a collapse targets the tile, never the focused split", () => {
    const tile = "fp-collapse-tile" as TerminalId;
    const split = "fp-collapse-split" as TerminalId;
    h.activeId = tile;
    h.focusedId = split;
    const rp = useRightPanel();
    rp.collapsePanel();
    flush();
    expect(rp.collapsed()).toBe(true);
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: tile, collapsed: true }),
    );
    // No write ever lands on the split for a visibility gesture.
    expect(h.setRightPanel).not.toHaveBeenCalledWith(
      expect.objectContaining({ id: split }),
    );
  });

  it("each pane keeps its own per-mode selected file", () => {
    const tile = "fp-file-tile" as TerminalId;
    const split = "fp-file-split" as TerminalId;
    h.activeId = tile;
    h.focusedId = split;
    const rp = useRightPanel();
    rp.code.setSelectedFile("browse", "split-only.ts");
    flush();
    expect(rp.code.selectedFile("browse")).toBe("split-only.ts");
    h.focusedId = undefined;
    expect(rp.code.selectedFile("browse")).toBeNull();
    rp.code.setSelectedFile("browse", "main-only.ts");
    flush();
    expect(rp.code.selectedFile("browse")).toBe("main-only.ts");
    h.focusedId = split;
    expect(rp.code.selectedFile("browse")).toBe("split-only.ts");
  });

  // The two halves of ONE defect: the mirror the write-only verbs consult used
  // to hold the store's own record, and the write replaced the whole selection
  // map. `setSelectedFile` lands in the Code view's EFFECT PHASE (the open
  // controller's `onResolved`), so the first half is a Solid dev diagnostic
  // (`STRICT_READ_UNTRACKED`, which `@kolu/solid-test-setup` fails the test
  // on), and the second is cost a reader can count: a write to one mode woke
  // the readers of the other modes' leaves.
  it("a selection written from an effect's apply arm reads no store leaf, and wakes only its own mode", () => {
    const tile = "fp-arm-tile" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    // Seed the LOCAL entry first: until this write there is none, and the
    // mirror carries the plain `freshPerTerminalState()` seed — the proxy only
    // arrives once `perTerminal[tile]` exists.
    rp.code.setSelectedFile("browse", "seed.ts");
    flush();
    createRoot((dispose) => {
      let browseRuns = 0;
      const browseFile = createMemo(() => {
        browseRuns += 1;
        return rp.code.selectedFile("browse");
      });
      expect(browseFile()).toBe("seed.ts");
      flush();
      const seeded = browseRuns;
      // The real caller's phase: a write from an effect's apply arm.
      createEffect(
        () => undefined,
        () => {
          rp.code.setSelectedFile("local", "from-the-arm.ts");
        },
        { name: "rightPanelArmSelection" },
      );
      flush();
      expect(rp.code.selectedFile("local")).toBe("from-the-arm.ts");
      expect(rp.code.selectedFile("browse")).toBe("seed.ts");
      // The `browse` leaf never moved, so nothing reading it re-ran.
      expect(browseRuns).toBe(seeded);
      // The report the write produced reached the wire's decode with the whole
      // selection map readable — and raised nothing doing it, from inside the
      // apply arm.
      expect(h.decoded).toEqual({
        selectedFileByMode: { browse: "seed.ts", local: "from-the-arm.ts" },
      });
      expect(h.setRightPanel).toHaveBeenLastCalledWith(
        expect.objectContaining({
          id: tile,
          selectedFileByMode: { browse: "seed.ts", local: "from-the-arm.ts" },
        }),
      );
      dispose();
    });
  });

  // THE PROPERTY, through the real writer. Codetab-B asserted one panel
  // application per selection write over its OWN root (a hand-driven
  // `perTerminal.selectedFileByMode` store), which says nothing about this
  // module's writer: the write here goes through the place mirror, `writeFrom`
  // and a detached store setter, from the phase the open controller calls it in
  // (`CodeTab`'s `finishOpenRequest` / `onResolved`). Five writes deep, because
  // a relay tear only escalates to `warn` on the third sighting.
  it("one panel application per selection write made from an effect's apply arm", () => {
    const tile = "fp-panel-tile" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    // The OTHER mode's standing pick, so a write that replaced the whole map
    // would have someone to wake — and a gesture pick in the mode under test,
    // which is the view's own first writer.
    rp.code.setSelectedFile("local", "ledger.rs");
    rp.code.setSelectedFile("browse", "seed.ts");
    flush();
    const applied: string[] = [];
    let localRuns = 0;
    let seededLocalRuns = 0;
    // The driving signal lives OUTSIDE the root: a plain signal write inside an
    // owned scope is `REACTIVE_WRITE_IN_OWNED_SCOPE`. The selection write is not
    // — `writeFrom` runs its store setter detached, which is the point.
    const [pick, setPick] = createSignal("f0.ts");
    let dispose!: () => void;
    createRoot((d) => {
      dispose = d;
      // The panel the Code tab writes: the shown pick and the other mode's,
      // minted by ONE compute and applied once per frame.
      const panel = createMemo(
        () =>
          `${rp.code.selectedFile("browse") ?? "-"}|${
            rp.code.selectedFile("local") ?? "-"
          }`,
      );
      createEffect(
        panel,
        (v) => {
          applied.push(v);
        },
        { name: "recordPanelApply" },
      );
      // A reader of the OTHER mode's leaf alone.
      const localFile = createMemo(() => {
        localRuns += 1;
        return rp.code.selectedFile("local");
      });
      createEffect(localFile, () => {}, { name: "readLocalLeaf" });
      flush();
      seededLocalRuns = localRuns;

      // The real caller's phase: the open controller RESOLVES a ref and lands
      // the selection from its effect's apply arm.
      createEffect(
        pick,
        (p) => {
          rp.code.setSelectedFile("browse", `src/${p}`);
        },
        { name: "rightPanelArmSelectionWrites" },
      );
    });
    flush();
    for (const p of ["f1.ts", "f2.ts", "f3.ts", "f4.ts"]) {
      setPick(p);
      flush();
    }

    // One application per selection write, each carrying that write's own
    // pick — never one frame pairing the new pick with the previous answer.
    expect(applied).toEqual([
      "seed.ts|ledger.rs",
      "src/f0.ts|ledger.rs",
      "src/f1.ts|ledger.rs",
      "src/f2.ts|ledger.rs",
      "src/f3.ts|ledger.rs",
      "src/f4.ts|ledger.rs",
    ]);
    // …and the other mode's leaf was never touched by any of them.
    expect(localRuns).toBe(seededLocalRuns);
    dispose();
  });

  // Absence is the only spelling of "no selection": the wire's `optionalKey`
  // rejects a present-but-`undefined` value, so an emptied map leaves the key
  // off the record entirely.
  it("dropping the last selection removes the map, and dropping one mode keeps the rest", () => {
    const tile = "fp-drop-tile" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    rp.code.setSelectedFile("browse", "a.ts");
    flush();
    rp.code.setSelectedFile("local", "b.ts");
    flush();
    rp.code.setSelectedFile("browse", null);
    flush();
    expect(rp.code.selectedFile("browse")).toBeNull();
    expect(rp.code.selectedFile("local")).toBe("b.ts");
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({
        id: tile,
        selectedFileByMode: { local: "b.ts" },
      }),
    );
    rp.code.setSelectedFile("local", null);
    flush();
    expect(rp.code.selectedFile("local")).toBeNull();
    expect(h.decoded).toEqual({});
    // An already-absent selection is not a write at all.
    h.setRightPanel.mockClear();
    rp.code.setSelectedFile("local", null);
    flush();
    expect(h.setRightPanel).not.toHaveBeenCalled();
  });

  it("navigation history is per pane", () => {
    const tile = "fp-hist-tile" as TerminalId;
    const split = "fp-hist-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    h.focusedId = undefined;
    rp.code.recordNavigation({ mode: "browse", path: "main.txt" });
    flush();
    rp.code.recordNavigation({ mode: "browse", path: "main2.txt" });
    flush();
    expect(rp.code.canNavigateBack()).toBe(true);
    // The split has its OWN stack — empty.
    h.focusedId = split;
    expect(rp.code.canNavigateBack()).toBe(false);
    rp.code.recordNavigation({ mode: "browse", path: "split.txt" });
    flush();
    expect(rp.code.navigateBack()).toBeNull(); // a single-entry stack
    flush();
    // Back to main: main's own earlier entry.
    h.focusedId = undefined;
    expect(rp.code.navigateBack()).toEqual({
      mode: "browse",
      path: "main.txt",
    });
  });

  it("seedSplitTab seeds a new split from the pane it was split from", () => {
    const tile = "fp-seed-tile" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    rp.showInspector(); // the tile's main pane is on Inspector
    flush();
    // The source is pinned at capture; a focus change before the create lands
    // must not change the seed.
    const initializePaneTab = rp.seedSplitTab(tile);
    h.focusedId = "fp-seed-other" as TerminalId;
    const split = "fp-seed-split" as TerminalId;
    initializePaneTab(split);
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: split, activeTab: "inspector" }),
    );
    h.focusedId = split;
    expect(rp.activeTab().kind).toBe("inspector");
  });

  it("seedSplitTab gives an externally-arrived split its parent's tab", () => {
    const tile = "fp-arrive-tile" as TerminalId;
    const split = "fp-arrive-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    rp.showInspector(); // the tile (the split's parent) is on Inspector
    flush();
    rp.seedSplitTab(tile)(split);
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: split, activeTab: "inspector" }),
    );
    h.focusedId = split;
    expect(rp.activeTab().kind).toBe("inspector");
  });

  it("seedSplitTab never overwrites a split that already has a record", () => {
    const tile = "fp-arrive2-tile" as TerminalId;
    const split = "fp-arrive2-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    // The split already carries its own state — its creator seeded it, or the
    // browser create path did before moving focus.
    h.focusedId = split;
    rp.showCode("branch");
    flush();
    h.setRightPanel.mockClear();
    rp.seedSplitTab(tile)(split);
    expect(h.setRightPanel).not.toHaveBeenCalled();
    expect(rp.code.codeMode()).toBe("branch");
  });

  it("seedSplitTab adopts a record the creator passed instead of overwriting it", () => {
    const tile = "fp-arrive3-tile" as TerminalId;
    const split = "fp-arrive3-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    // The creator passed its own `rightPanel` on `lifecycle.create`; it is on the
    // terminal's metadata, and the client store must adopt it — not replace it
    // with the parent tile's tab.
    h.metadata = {
      rightPanel: {
        collapsed: false,
        activeTab: "inspector",
        codeMode: "branch",
      },
    };
    rp.seedSplitTab(tile)(split);
    h.focusedId = split;
    expect(rp.activeTab().kind).toBe("inspector");
    expect(rp.code.codeMode()).toBe("branch");
    // Adopted, not reported back: the server already holds this record.
    expect(h.setRightPanel).not.toHaveBeenCalled();
  });

  it("adoptTileCollapsed hands a promoted split the posture of the tile it left", () => {
    const tile = "fp-promote-tile" as TerminalId;
    const split = "fp-promote-split" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    rp.collapsePanel(); // the tile's panel is closed
    flush();
    rp.adoptTileCollapsed(tile)(split);
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: split, collapsed: true }),
    );
    // Once the split IS its own tile, its now-live collapsed reads closed.
    h.activeId = split;
    h.focusedId = undefined;
    expect(rp.collapsed()).toBe(true);
  });

  it("adoptTileCollapsed is a no-op when the from-tile IS the terminal", () => {
    const tile = "fp-self-tile" as TerminalId;
    h.activeId = tile;
    const rp = useRightPanel();
    rp.collapsePanel();
    flush();
    h.setRightPanel.mockClear();
    rp.adoptTileCollapsed(tile)(tile);
    expect(h.setRightPanel).not.toHaveBeenCalled();
  });
});

// `syncRepo` owns the per-terminal history-reset decision: a back/forward stack
// records repo-relative `{ mode, path }` locations with no repo identity, so it
// must be dropped when the terminal it belongs to moves to a different repo —
// but NOT when the user merely switches the active terminal between two repos.
// The decision is keyed per terminal (`history.get(id).lastRepo`) — the pane
// the caller names together with its root — which is what lets
// it catch a repo change that happened while the terminal was INACTIVE (F6): a
// previous-active-tuple compare would see the switch-back as a plain terminal
// change and skip the reset, replaying repo-A history against repo A's new repo.
describe("useRightPanel — syncRepo scopes history per repo, per terminal", () => {
  // Drive history for whichever terminal is active, the way CodeTab does — one
  // navigation per frame, since a push reads the stack it appends to and a
  // write is staged until the next flush.
  function recordAt(id: TerminalId, ...paths: string[]): void {
    h.activeId = id;
    const rp = useRightPanel();
    for (const path of paths) {
      rp.code.recordNavigation({ mode: "browse", path });
      flush();
    }
  }

  it("first sight records the baseline without resetting a seeded/built stack", () => {
    const a = "f6-first-A" as TerminalId;
    recordAt(a, "one.txt", "two.txt");
    const rp = useRightPanel();
    h.activeId = a;
    expect(rp.code.canNavigateBack()).toBe(true);
    // First syncRepo for this terminal just adopts its repo — history survives.
    rp.syncRepo(a, "/repo/A");
    flush();
    expect(rp.code.canNavigateBack()).toBe(true);
  });

  it("a genuine repo change on the same terminal drops its history", () => {
    const a = "f6-cd-A" as TerminalId;
    recordAt(a, "one.txt", "two.txt");
    const rp = useRightPanel();
    h.activeId = a;
    rp.syncRepo(a, "/repo/A"); // baseline
    flush();
    expect(rp.code.canNavigateBack()).toBe(true);
    rp.syncRepo(a, "/repo/A2"); // cd into another repo
    flush();
    expect(rp.code.canNavigateBack()).toBe(false);
  });

  it("switching the active terminal between repos preserves each terminal's history (F5)", () => {
    const a = "f6-switch-A" as TerminalId;
    const b = "f6-switch-B" as TerminalId;
    const rp = useRightPanel();
    recordAt(a, "a1.txt", "a2.txt");
    h.activeId = a;
    rp.syncRepo(a, "/repo/A");
    flush();
    recordAt(b, "b1.txt", "b2.txt");
    h.activeId = b;
    rp.syncRepo(b, "/repo/B");
    flush();
    // Switch back to A — same repo as before, so its history must be intact.
    h.activeId = a;
    rp.syncRepo(a, "/repo/A");
    flush();
    expect(rp.code.canNavigateBack()).toBe(true);
    // And B's is untouched too.
    h.activeId = b;
    rp.syncRepo(b, "/repo/B");
    flush();
    expect(rp.code.canNavigateBack()).toBe(true);
  });

  it("resets a terminal whose repo changed WHILE INACTIVE, caught on switch-back (F6)", () => {
    const a = "f6-inactive-A" as TerminalId;
    const b = "f6-inactive-B" as TerminalId;
    const rp = useRightPanel();
    // A builds history in repo A and becomes the baseline.
    recordAt(a, "a1.txt", "a2.txt");
    h.activeId = a;
    rp.syncRepo(a, "/repo/A");
    flush();
    expect(rp.code.canNavigateBack()).toBe(true);
    // Switch to B; A is now inactive. (CodeTab only ever syncs the active id.)
    recordAt(b, "b1.txt");
    h.activeId = b;
    rp.syncRepo(b, "/repo/B");
    flush();
    // While A was inactive its PTY cd'd into a different repo — the metadata
    // change reaches CodeTab only when A becomes active again. The previous
    // active tuple was (B, /repo/B), so a previous-tuple compare would treat
    // this as a plain terminal switch and SKIP the reset; per-terminal tracking
    // sees A's own repo moved (/repo/A → /repo/A2) and drops the stale stack.
    h.activeId = a;
    rp.syncRepo(a, "/repo/A2");
    flush();
    expect(rp.code.canNavigateBack()).toBe(false);
  });

  // A focus move is one propagation step: for that step the root last handed
  // over is still the PREVIOUS pane's. The reset must be told which pane that
  // root belongs to — the pane read with it — not whichever pane has focus by
  // now, or the newly focused pane is told the old pane's root and its history
  // is wiped.
  it("a focus move while the previous pane's root is still being handed over clears neither pane's history", () => {
    const a = "f6-tear-A" as TerminalId;
    const b = "f6-tear-B" as TerminalId;
    const rp = useRightPanel();
    recordAt(a, "a1.txt", "a2.txt");
    rp.syncRepo(a, "/repo/A");
    flush();
    recordAt(b, "b1.txt", "b2.txt");
    rp.syncRepo(b, "/repo/B");
    flush();
    // Focus is on B, and the subject handed over still names A with A's root.
    h.activeId = b;
    rp.syncRepo(a, "/repo/A");
    flush();
    expect(rp.code.canNavigateBack()).toBe(true);
    h.activeId = a;
    expect(rp.code.canNavigateBack()).toBe(true);
  });
});

describe("new terminal panel visibility", () => {
  it.each([
    true,
    false,
  ])("inherits collapsed=%s before activation and persists it", (collapsed) => {
    const rp = useRightPanel();
    const previous = `previous-${collapsed}` as TerminalId;
    const next = `new-${collapsed}` as TerminalId;
    h.activeId = previous;
    collapsed ? rp.collapsePanel() : rp.expandPanel();
    flush();
    const initializePanel = rp.adoptTileCollapsed(previous);
    // A focus change while the create RPC is pending must not change the seed.
    h.activeId = `other-${collapsed}`;
    h.host = "host-B";
    initializePanel(next);
    expect(h.saveOnOtherHost).not.toHaveBeenCalled();
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: next, collapsed }),
    );
    h.activeId = next;
    expect(rp.collapsed()).toBe(collapsed);
    collapsed ? rp.expandPanel() : rp.collapsePanel();
    flush();
    h.activeId = previous;
    expect(rp.collapsed()).toBe(collapsed);
  });
});

describe("new panel initialization", () => {
  it.each([
    true,
    false,
  ])("uses the initial preference with no active terminal: %s", (collapsed) => {
    h.prefs.newTerminalCollapsed = collapsed;
    const rp = useRightPanel();
    // No active tile to inherit from — the seed falls back to the preference.
    const initializePanel = rp.adoptTileCollapsed(null);
    const id = `empty-${collapsed}` as TerminalId;
    initializePanel(id);
    flush();
    h.activeId = id;
    expect(rp.collapsed()).toBe(collapsed);
    expect(h.setRightPanel).toHaveBeenLastCalledWith(
      expect.objectContaining({ id, collapsed }),
    );
  });

  it("preserves a tab selected before creation completes", () => {
    const rp = useRightPanel();
    const initializePanel = rp.adoptTileCollapsed(null);
    const id = "early-panel-interaction" as TerminalId;
    h.activeId = id;
    rp.showInspector();
    initializePanel(id);
    flush();
    expect(rp.activeTab()).toEqual({ kind: "inspector" });
  });
});
