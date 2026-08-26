/**
 * `@kolu/padi-client/surface` UI-CHROME vocabulary — the canvas/right-panel presentation
 * schemas and their pure presentation helpers, split out of `./vocab.ts` (W4
 * ledger L17). These change on a CHROME axis (a canvas layout tweak, a Code-tab
 * sub-view, the right-panel tab set) that is INDEPENDENT of the PTY-lifecycle /
 * session-persistence axis `vocab.ts` owns — two volatilities that used to churn
 * one 900-line module. The terminal-metadata schemas in `vocab.ts` consume these
 * (a terminal remembers its canvas tile + sub-panel state), so the dependency
 * arrow points ONE way: `vocab.ts` → `chromeVocab.ts`, never back.
 *
 * Surfaced through the SAME entry as the rest of the vocabulary: `surface.ts`
 * re-exports this module beside `./vocab.ts`, so `@kolu/padi-client/surface` carries the
 * identical export set it always did. BROWSER-SAFE (Effect Schema only, no
 * `node:` imports) so the client imports it via `@kolu/padi-client/surface`.
 */

import { Effect, Schema } from "effect";

export const CanvasLayoutSchema = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  w: Schema.Number,
  h: Schema.Number,
});

export const SubPanelStateSchema = Schema.Struct({
  collapsed: Schema.Boolean,
  panelSize: Schema.Number,
});

/** Sub-view of the Code tab: local/branch diff modes or the file browser. */
export const CodeTabViewSchema = Schema.Literals(["local", "branch", "browse"]);

/** Which tab is currently displayed in the right panel. */
export const RightPanelTabKindSchema = Schema.Literals(["inspector", "code"]);

/** Per-terminal right-panel state — whether the panel is showing, which
 *  tab is open, which sub-mode the Code tab is in, and which file the user
 *  last selected in each mode. The fields move together because they are
 *  *about* the terminal's task (reviewing branch X, browsing repo, inspecting
 *  agent output) — switching terminals should restore them as a unit, so the
 *  panel *follows the terminal* (#959). `collapsed` joined this record when
 *  the last still-global posture bit moved per-terminal: a PR-review terminal
 *  keeps its panel open while a build-log terminal keeps its closed, instead
 *  of one global bit forcing both. (The panel WIDTH and the Code-tab tree/
 *  content split stay on `preferences.rightPanel` — those are viewer density
 *  taste, tuned once and left put, not per-terminal task state.)
 *
 *  `selectedFileByMode` is per-mode so flipping between local↔branch↔browse
 *  within a single terminal keeps each mode's last-viewed file, mirroring
 *  the prior `(repo, mode)`-keyed localStorage slot behaviour.
 *
 *  Storage is flat (`collapsed` + `activeTab` + `codeMode` as parallel
 *  fields) so Solid's shallow-merge `setStore` is correct. Consumption of the
 *  tab should go through the `rightPanelView()` DU projection — pattern-matching
 *  on `activeTab` / `codeMode` separately leaks the storage shape across the DU
 *  seam and defeats the "codeMode survives Inspector toggle" invariant.
 *
 *  `collapsed` carries a schema decoding default (`false`) so a `rightPanel`
 *  record persisted before this field existed (only `activeTab`/`codeMode`)
 *  parses back as open — the shipped runtime default — with no migration.
 *  KEY-level (`withDecodingDefaultKey`, PLAN #17): a MISSING key backfills, an
 *  explicit `undefined` is REJECTED, which is what a disk/wire field means. The
 *  decoded value always carries the key, so the encoded JSON is byte-identical
 *  to what zod's `.default(false)` emitted. */
export const RightPanelPerTerminalStateSchema = Schema.Struct({
  /** Whether the panel is collapsed (hidden) for THIS terminal. Moved off the
   *  global preference so each terminal remembers whether its panel was open. */
  collapsed: Schema.Boolean.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(false)),
  ),
  activeTab: RightPanelTabKindSchema,
  codeMode: CodeTabViewSchema,
  /** Repo-relative file paths keyed by Code-tab sub-mode. Absence of a
   *  key means "no selection" for that mode. */
  selectedFileByMode: Schema.optionalKey(
    Schema.Struct({
      local: Schema.optionalKey(Schema.String),
      branch: Schema.optionalKey(Schema.String),
      browse: Schema.optionalKey(Schema.String),
    }),
  ),
});

export type CanvasLayout = typeof CanvasLayoutSchema.Type;
export type CodeTabView = typeof CodeTabViewSchema.Type;
export type RightPanelTabKind = typeof RightPanelTabKindSchema.Type;
export type RightPanelPerTerminalState =
  typeof RightPanelPerTerminalStateSchema.Type;

/** Discriminated-union view of the right panel's active tab. Derived from the
 *  flat `activeTab` + `codeMode` storage shape — see `rightPanelView()`. Use
 *  this for pattern matching at consumption sites; never write code that
 *  matches on `activeTab` and reads `codeMode` separately. */
export type RightPanelTab =
  | { kind: "inspector" }
  | { kind: "code"; mode: CodeTabView };

/** User-facing name of a Code-tab view — the single source for the words the
 *  mode picker renders as a chip label and the file-tree right-click menu
 *  composes its "jump to view" entries from. Defining it once keeps the two
 *  surfaces in sync structurally rather than by convention. */
const VIEW_LABELS: Record<CodeTabView, string> = {
  browse: "All files",
  local: "Local",
  branch: "Branch",
};

/** Display name for a Code-tab view (e.g. "All files" / "Local" / "Branch"). */
export function viewLabel(view: CodeTabView): string {
  return VIEW_LABELS[view];
}

/** Canonical left-to-right order of the Code-tab views — the single source the
 *  scope switcher's segments and the file-tree right-click "jump to view"
 *  entries both order themselves by. Defined here (not derived from
 *  `CodeTabViewSchema`, whose enum order is storage-driven and differs) so the
 *  two surfaces stay in sync structurally rather than by a convention comment.
 *  Adding a view is one edit here. */
export const CODE_TAB_VIEW_ORDER = ["browse", "local", "branch"] as const;

/** Default per-terminal right-panel state — seeded into the in-memory
 *  store when a terminal has no `rightPanel` record yet (fresh terminals,
 *  or terminals from a session predating this schema). */
export const DEFAULT_RIGHT_PANEL_PER_TERMINAL: RightPanelPerTerminalState = {
  collapsed: false,
  activeTab: "code",
  codeMode: "browse",
};

/** Project the flat `RightPanelPerTerminalState` shape onto its DU view.
 *  Storage stays flat (Solid's setStore shallow-merges correctly); use sites
 *  get the exhaustive-match-friendly DU. */
export function rightPanelView(p: {
  activeTab: RightPanelTabKind;
  codeMode: CodeTabView;
}): RightPanelTab {
  return p.activeTab === "inspector"
    ? { kind: "inspector" }
    : { kind: "code", mode: p.codeMode };
}
