# Rename Terminal → Workspace (#212, without sidebar nesting)

## What

Rename the hierarchy: Terminal → Workspace, Sub-terminal → Terminal. Pure terminology change — no sidebar nesting, no structural changes to the data model.

## Scope

### User-facing strings

- Commands: "Toggle sub-panel" → "Toggle terminal panel", "New sub-terminal" → "New terminal"
- Keyboard shortcut labels (not the keys themselves)
- Tips text
- Sidebar: button text, aria labels, badge tooltips
- README

### Code identifiers

- File renames: `useSubPanel` → `useTerminalPanel`, `SubPanelTabBar` → `TerminalTabBar`, etc.
- Function/variable renames: `handleCreateSubTerminal` → `handleCreateTerminal`, `subTerminalIds` → `terminalIds` (child), `terminalIds` → `workspaceIds`, etc.
- Component names matching file renames

### E2E tests

- Feature files: "sub-terminal" → "terminal", scenario names
- Step definitions: matching renames

### What stays

- `parentId` field — generic relationship name, no rename needed
- Wire protocol types — rename only if no migration required
- State schema version — only bump if persisted field names change

## Non-goals

- Sidebar nesting (expandable workspace items showing nested terminals)
- New UI components
- Behavioral changes
