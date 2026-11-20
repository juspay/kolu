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

/** Per-terminal right-panel state — whether the panel is showing, which tab is
 *  open, which sub-mode the Code tab is in, and which file the user last
 *  selected in each mode.
 *
 *  `selectedFileByMode` is per-mode so flipping between local↔branch↔browse
 *  within a single terminal keeps each mode's last-viewed file. `collapsed`
 *  carries a decoding default (`false`), so a record persisted before the field
 *  existed parses back as open. */
export const RightPanelPerTerminalStateSchema = Schema.Struct({
  /** Whether the panel is collapsed (hidden) for THIS terminal. */
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

/** Discriminated-union view of the right panel's active tab, derived from the
 *  flat `activeTab` + `codeMode` storage shape by {@link rightPanelView}. */
export type RightPanelTab =
  | { kind: "inspector" }
  | { kind: "code"; mode: CodeTabView };

/** User-facing name of a Code-tab view. */
const VIEW_LABELS: Record<CodeTabView, string> = {
  browse: "All files",
  local: "Local",
  branch: "Branch",
};

/** Display name for a Code-tab view (e.g. "All files" / "Local" / "Branch"). */
export function viewLabel(view: CodeTabView): string {
  return VIEW_LABELS[view];
}

/** Canonical left-to-right order of the Code-tab views — the order the scope
 *  switcher's segments and the file-tree "jump to view" entries render in. */
export const CODE_TAB_VIEW_ORDER = ["browse", "local", "branch"] as const;

/** Default per-terminal right-panel state — seeded into the in-memory
 *  store when a terminal has no `rightPanel` record yet (fresh terminals,
 *  or terminals from a session predating this schema). */
export const DEFAULT_RIGHT_PANEL_PER_TERMINAL: RightPanelPerTerminalState = {
  collapsed: false,
  activeTab: "code",
  codeMode: "browse",
};

/** Project the flat `RightPanelPerTerminalState` shape onto its DU view. */
export function rightPanelView(p: {
  activeTab: RightPanelTabKind;
  codeMode: CodeTabView;
}): RightPanelTab {
  return p.activeTab === "inspector"
    ? { kind: "inspector" }
    : { kind: "code", mode: p.codeMode };
}
