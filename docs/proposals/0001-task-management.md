---
title: Task Management
number: 0001
status: draft
author: ThisIsMani
created: 2026-04-27
---

# 0001 — Task Management

## Summary

Add a thin, opt-in layer above terminals so a developer's *intent* — "fix the auth bug", "learn about CRDTs", "investigate the slow startup" — can persist independently of any process. Projects group related work; tasks represent intent inside a project; terminals optionally tag themselves to a task. State lives in plain markdown (one file per project, format mirroring [obsidian-kanban](https://github.com/obsidian-community/obsidian-kanban)) which Kolu reads, parses, and writes on user action — never autonomously. Nothing about today's terminal-centric flow changes; users who don't opt in see no difference.

## Motivation

Kolu today is excellent at terminals — spawn one, focus it, split it, switch between them. There is nothing above the terminal. Once a terminal is closed, the *intent* it served is gone. Concrete scenarios where that falls short:

- *"What was I doing yesterday?"* — A developer closed a session that involved three terminals investigating a flaky test. Today, that effort is unrecoverable except from shell history. Wanted: a labeled bookmark — "investigating flaky test X" — that survives the terminals and tells them where they were.
- *"I want to learn about Y."* — The intent has no repo. Today, the developer either spawns a terminal at `~/` and gives the agent instructions verbally, or doesn't capture the intent at all. Wanted: a place to write down "learn about CRDTs" and attach whichever terminals end up serving it.
- *"These three terminals are the same effort."* — A debugging session that grew to several panes shares one underlying purpose. Today there is no way to express that grouping. Wanted: a parent the user can name.
- *"Where did I park that task?"* — Coming back after a context switch, the developer wants a list of unfinished work — not a list of recent repos, not a list of zombie terminals.

The thread connecting all four: a unit of intent that exists *above* terminals, scoped per project, fully under user control.

## Core principle

**Kolu has agency over IO. Kolu has no agency over semantics.**

Kolu reads, parses, and writes the user's task data when the user acts. Kolu does *not* infer, autonomously update, observe agents and decide things, or generally do anything "smart" with the data on its own. The user is the brain; Kolu is the hands.

Concretely:

- A task is "done" when the user says it is. Not when a terminal exits, not when an agent's `taskProgress` reaches `n/n`, not when the agent says "I think I'm done."
- A task moves between lanes because the user moves it. Never because Kolu inferred something.
- Kolu writes the persisted form (markdown) on user action; it never writes spontaneously.

This principle is what keeps the feature small. Every time something feels like it wants to be "smart", check it against this principle and the answer is usually "no, the user does that themselves."

## User-facing behavior

Three layers, each opt-in:

```
Project
   └── Tasks (live in user-defined lanes)
           └── Terminals (optionally tagged with taskId)
```

### Navigation

Three top-level routes:

- `/` — the workspace (terminal canvas, exactly as today).
- `/projects/<projectId>` — that project's kanban board.
- `/tasks` — the cross-project view (time-ordered table over every task in every project; see [Cross-project view](#cross-project-view)).

Browser back/forward and bookmarkable URLs come for free. Project navigation lives entirely in the URL — there is no `preferences.activeProject`. Right-panel state (Inspector vs. Code, collapsed/expanded) stays in preferences as today; that's pane-level chrome state, orthogonal to which project the user is looking at.

Project addressing uses the existing `Project.id` (UUID) directly: `/projects/7f3e1d2a-…`. There is no separate URL-friendly slug field — a project rename only changes the displayed name, the URL stays stable, no bookmarks break.

Mobile swipe navigation (per [#622](https://github.com/juspay/kolu/issues/622)) is preserved as a *gesture layer* that calls `navigate()` rather than a parallel navigation stack. Swipe-left, swipe-right, browser back/forward all push and pop the same route history. One stack, one source of truth.

Switching projects from inside the workspace: command palette → `Projects` group → list of curated projects → selection navigates to `/projects/<id>`.

### Projects

A user-curated, named, optionally path-bound container.

```ts
type Project = {
  id: string;             // kolu-managed UUID
  name: string;           // user-chosen
  repoPath?: string;      // optional; missing for topic projects and the synthetic "No Project"
  archived?: boolean;
};
```

`repoPath` is **optional**. Most projects have a path (a real repo on disk); some don't (topic-only projects like *"Learn CRDTs"*, or the synthetic "No Project" container described below). Kolu's `strict` TypeScript enforces a null branch at every consumer that needs the path — terminal-cwd seeding, git operations, file browser — so the absence is type-checked, not silently ignored.

A reserved synthetic project — displayed as **"No Project"** — exists to hold *floating* tasks (tasks the user created without picking a project). It is identified by a single reserved UUID constant kept in code, not by its display name and not by `repoPath` being absent. A user who creates a real project and names it "No Project" does not collide with the synthetic one — identity is structural, not textual.

### Project lifecycle: creating, editing, archiving

**Create.** Command palette → `New project` → opens `CreateProjectModal`:

- *Name* (required, text input).
- *Repo path* (optional, text input). Pre-filled from the active terminal's `cwd` if any. Autocompletes from `recentRepos`. Leave blank for a topic-only project (e.g. *"Learn CRDTs"*).
- `[Create]` → adds the project, navigates to `/projects/<id>`.

**Edit.** Command palette → `Edit project` → pick from list → opens `EditProjectModal` pre-filled with the existing values. Same field set, different semantics around side-effects (renaming may trigger a board-file move when the path-resolution layer is aware of `name`). Create and edit are kept as **separate modal components** sharing only a stateless `<ProjectForm>` for the field layout — so their validation rules, side-effects, and future divergence don't tangle.

**Archive.** Command palette → `Archive project`. Sets `archived: true` on the project record. Archived projects are hidden from the default `Projects` list but reachable via `Show archived projects`. The synthetic "No Project" cannot be archived.

**Delete.** Out of scope for this proposal. If the user wants to permanently remove a project, they delete the project's directory under `~/.config/kolu/projects/` manually. Archive is the only in-app affordance.

### Tasks

Pure intent metadata. A task is a labeled bookmark of "what I was working on."

```ts
type Task = {
  id: string;             // kolu-managed; encoded as a hidden block-id in markdown
  projectId: string;      // mandatory; floating tasks live under the synthetic "No Project"
  name: string;           // user-typed
  description?: string;   // user-typed; freeform markdown
  updatedAt: number;      // last meaningful interaction (see below)
};
```

Notably **absent**:

- A `status` field. The lane a task lives in *is* its status. Carrying `status` on the task object would denormalize lane membership and require two writes for every state change. Status is computed at read time from "which lane currently contains this task."
- A `createdAt` field. Once a task has moved between lanes a few times, "when did this first exist" is no longer recoverable from the markdown — and we'd rather not pretend otherwise. For a personal kanban, "when did I last interact with this" is the question that matters; "when did I first jot it down" is not.
- A `completedAt` field. Completion is purely a derived fact: *if the task's current lane has the `complete` role, the task is done at `updatedAt`; otherwise it isn't done.* Moving a task back out of Done and re-completing it re-stamps `updatedAt` — the original completion date is not preserved. See [Out of scope](#out-of-scope) for the deliberate trade.

`updatedAt` semantics: **last meaningful interaction**. Bumped to `now` whenever:

- The task moves between lanes (drag-to-different-lane).
- The title is edited inline.
- The description is edited inline.

**Not** bumped on drag-to-reorder *within the same lane* — reordering is presentation, not content. The user expects "this task was last touched yesterday" to mean *the task's content or location changed*, not *I dragged it up two slots in the same column.*

### Lanes

User-defined per project. A lane is just a heading in the project's markdown file; the lane name is whatever the user typed. Two projects can both have lanes named "Done", or one called "🔥 fires" and another "Reading" — the system imposes no vocabulary.

A lane can carry a `complete` *role* (zero or one role today; the schema leaves room for more — see Out of scope). A lane with the `complete` role is treated as the "done" column: tasks living there are *currently completed* (with their completion time being the same `updatedAt` annotation every other lane carries).

### The project board (per project)

The primary view for working *inside* a project. Lanes laid out left-to-right; tasks shown as cards within. A card displays:

- Title.
- Description preview (collapsed past ~3 lines — see [Card interactions](#card-interactions)).
- Linked terminal pills (if any terminals are tagged to this task).
- A check + completion timestamp when the lane carries the `complete` role.

The `+ add task` affordance lives at the bottom of each lane.

### Card interactions

A task card is a self-sufficient surface — there is no detail view, modal-on-click, or drawer. Everything important about a task is visible on the card; everything you can do *to* a task is done from the card directly. Five distinct affordances:

| Surface | Action |
|---|---|
| Click + hold + drag the card body | Move the task between lanes |
| Click on the title text | Enter inline edit (text input replaces the title) |
| Click on the description text | Enter inline edit (textarea) |
| Click a terminal pill on the card | Navigate to `/` and focus that terminal |
| Click ✕ in the top-right corner | Open `DeleteTaskConfirm` modal → confirm to delete |

Click on empty card area is a no-op. Inline edit commits on Enter (title) or blur (both); Escape cancels.

**Long descriptions: collapse-by-heuristic.** When a task's description exceeds ~3 lines, the card starts collapsed with a `▸` chevron exposing only the title and meta. Click the chevron to expand to `▾` and reveal the description. The expand/collapse state is **session-only** — not persisted to markdown, not stored in preferences. On reload or project switch, every card returns to its heuristic default. Markdown stays free of UI chrome; preferences don't grow an unbounded `Record<TaskId, boolean>`.

Terminal-pill click is the path the proposal owes a word about: clicking a pill navigates to `/` (workspace) and focuses the corresponding terminal. The browser back-button returns the user to the project board. This works because navigation is route-driven (see [Navigation](#navigation)) — no separate "go back to where I was" affordance needs to exist.

### Task lifecycle: creating, editing, deleting

**Create.** One underlying operation — `createTask(input)` — invoked through two affordances:

- **Per-lane "+ add task"** — an inline input at the bottom of each lane. Project and lane are inferred from context; the user types only a title. Fast path for *"drop a thought into the right column."*
- **Command palette → `New task`** — opens `CreateTaskModal` asking project, lane, title, description. Lane defaults to the project's first lane; project defaults to the last-active project (or "No Project"). Slower, more deliberate path; works from anywhere, including with no project open.

Both affordances pre-fill different subsets of the same input shape and share the write path. There is no `createTaskInline` and `createTaskModal` — only `createTask`.

**Edit.** Two paths:

- **Inline** — click the title or description on the card (see [Card interactions](#card-interactions)). The card stays in place; the field becomes editable. Primary path.
- **Command palette → `Edit task`** — list → pick → opens `EditTaskModal` pre-filled with current values. Useful when the card isn't visible (cross-project view, or you forgot which project a task lives in).

**Delete.** Click ✕ on the card → `DeleteTaskConfirm` modal (mirrors kolu's existing `CloseConfirm` pattern at `packages/client/src/CloseConfirm.tsx:61-69` for risky actions). The palette has no `Delete task` command — `Cmd+K` has no notion of *"this task right here"*, only the card does. Deletion is anchored to the card surface, not the palette.

### Cross-project view

A separate view — **not a board**. A time-ordered list/table over all tasks across all projects:

| Updated | Project | Lane | Task |
|---------|---------|------|------|
| 2h ago | kolu-board-spec | Doing | Learn CRDTs |
| 5h ago | kolu | Todo | Refactor session module |
| yesterday | kolu-board-spec | Done ✓ | Set up dev env |
| 3d ago | No Project | Reading | Read CRDT paper X |

`Lane` is just a string per project — no aggregation, no normalization. Project A's "Doing" and Project B's "In progress" are unrelated strings. Filter by project, lane name, or recency; sort however.

### Terminals: optional task tagging

A terminal can be tagged with a `taskId`. Tagged terminals show a "▸ task name" line in their title bar; clicking it jumps to the task in its project board. Untagged terminals look exactly like Kolu's terminals today.

Tagging is a user act. Kolu does not infer task-terminal relationships from `cwd`, agent kind, or any heuristic.

### Storage

Each project has one markdown file. Format mirrors [obsidian-kanban](https://github.com/obsidian-community/obsidian-kanban) so the file is parser-compatible if a user ever wants to view or edit it in Obsidian:

```markdown
---
kolu-board: v1
projectId: 7f3e...
---

## Todo

- [ ] Fix login bug <!-- ^abc123 --> @{2026-04-20}
- [ ] Refactor session module <!-- ^def456 --> @{2026-04-19}
  Splits the auth and session storage modules.

## Doing

- [ ] Learn CRDTs <!-- ^ghi789 --> @{2026-04-22}

## Done

**Complete**

- [x] Set up dev env <!-- ^jkl012 --> @{2026-04-25}
```

Conventions:

- `## LaneName` — heading is the lane.
- `**Complete**` immediately under a heading flags the lane with the `complete` role (matches obsidian-kanban exactly).
- `- [ ]` / `- [x]` items are tasks. Checkbox state is decorative; lane membership is canonical.
- `<!-- ^id -->` HTML comments hold task block-ids. Hidden in rendered markdown so users don't accidentally clobber them while editing.
- `@{YYYY-MM-DD}` on each task line is the task's `updatedAt` — the date of its last meaningful interaction (see [Tasks](#tasks) for what counts). Kolu writes this on every task, in every lane (not just `complete`-role lanes). Hand-edits in another editor that delete the annotation are auto-healed on the next Kolu save.

The file is **plain markdown**. Kolu is the primary editor, but users can hand-edit in any tool. Kolu watches for filesystem changes and reparses on update. Last-write-wins conflict resolution; reasonable for a personal-use feature.

**Default location**: `~/.config/kolu/projects/<projectId>/board.md` — alongside Kolu's other state. Survives Kolu uninstall/reinstall as a single directory copy; doesn't pollute the user's repo. Two distinct user populations are concretely known to exist:

1. *Tool-managed* — the default. Kolu owns storage; user doesn't version it.
2. *Git-versioned* — board lives at `<repoPath>/.kolu/board.md`, committed alongside code.

Both populations are real today. The default covers (1); the implementation should leave the path-resolution layer pluggable so (2) can be added without schema reshaping.

## Prototype

See [`./0001-task-management/mockup.html`](./0001-task-management/mockup.html) — open in a browser. Each frame's chrome carries a faux URL bar showing the route it lives at. Five views:

1. **Per-project board** at `/projects/<id>` — lanes, cards (with `@{YYYY-MM-DD}` chip, ✕ delete on hover, ▸ collapse chevron on long descriptions), terminal pills, completion check.
2. **What's on disk** *(explanation only)* — the raw markdown that produces view 1, rendered side-by-side. Not a proposed Kolu surface; included to make the file format concrete.
3. **Cross-project view** at `/tasks` — time-ordered table.
4. **Terminal canvas with task tags** at `/` — existing canvas; one new title-bar affordance.
5. **Creation UI** *(proposed)* — per-lane inline `+ add` and the command-palette `New task` modal.

## Implementation notes

Optional pointers, not prescriptions:

- Block-IDs (`^abc123`) are kolu-managed and must be invisible to the user — store them in HTML comments so hand-edits don't clobber them.
- The path-resolution layer that maps `(projectId) → board.md path` should be small and replaceable. The default implementation returns `~/.config/kolu/projects/<id>/board.md`; a future per-project `boardPath` override (for git-versioned boards) plugs into the same seam.
- The synthetic "No Project" container is identified by a single reserved UUID constant. Display rendering substitutes the label "No Project"; storage and code paths treat it like any other project.
- **Routing.** Adopting a SolidJS-compatible router (`@solidjs/router` or similar) is a structural prerequisite. Today kolu has no router (`packages/client/src/App.tsx` is mode-less per [#622](https://github.com/juspay/kolu/issues/622)) — this proposal explicitly revisits that stance. The implementer should treat routing as a workspace-wide change, not a feature-local one.
- **Task card is a layout shell, not a god-component.** Each affordance (drag, inline-edit-title, inline-edit-description, terminal-pill nav, delete ✕) should isolate into its own hook or sub-component (`useDragTaskCard`, `<EditableTitle>`, `<EditableDescription>`, `<TaskCardDeleteConfirm>`, etc.). The card itself orchestrates layout; behavior lives in the parts.
- **Create and edit are separate modals.** `CreateProjectModal` / `EditProjectModal` (and the same shape for tasks) share a stateless `<ProjectForm>` / `<TaskForm>` for field rendering, but each modal owns its own validation, side-effect, and lifecycle semantics. Avoid a single `<ProjectModal isEdit={...}>` that branches internally.
- **Card expand/collapse state is session-only.** Hold it in a per-board UI-state hook (e.g. `useProjectBoardUIState()`) keyed by task id; never persist to markdown or preferences. The default value is computed from the description length.
- **Schema and migrations.** Parsed boards are validated through Zod schemas — `TaskSchema`, `LaneSchema`, `BoardSchema` — that mirror the discipline of the existing `PersistedStateSchema` at `packages/server/src/state.ts:34-39`. The `kolu-board: v1` frontmatter is the canonical version handle for the on-disk format; bumping to `v2` means writing a `migrateBoardFromV1ToV2` function that runs on parse, same migration-ladder pattern as `state.json`. The exact home for the schema files (client package vs. `kolu-common`) is left to the implementer — `PersistedStateSchema` lives where its data is owned, and these schemas should follow the same rule.

## Alternatives considered

- **`status` as a field on Task.** Rejected — denormalizes lane membership, requires two writes per state change. Lane is canonical; status is computed at read time.
- **Predefined status enum (`todo / doing / done`)** with user-defined sub-lanes. Rejected — collapsing different per-project meanings (e.g. `Blocked` shown under `Todo` in a unified view) is misleading. Cross-project alignment is solved by switching to a *time-ordered list* rather than a unified board.
- **Hybrid: predefined enum + freeform tags.** Rejected — gives up the "I name my own lifecycle" win, which is the whole reason for adopting an obsidian-kanban-style model.
- **Agent-driven completion** (Kolu observing `taskProgress` from `agent-provider.ts` and writing back). Rejected by the core principle — agents may *suggest*, but the user *decides*. The UI may surface "agent thinks this is done" as a passive affordance; it never writes.
- **Inferring task done from terminal exit.** Rejected — process lifecycle and intent lifecycle are independent clocks. A terminal can exit because the user closed it; the task is nowhere near done.
- **Gantt views.** Rejected — Gantt needs `startsAt` *and* `endsAt`. Picking a "start" lane introduces a second designation problem and edges into project-management territory the proposal explicitly excludes (see Out of scope).
- **`Project` and `recentRepos` unified into one store.** Rejected — auto-MRU and user curation have different change rates and serve different purposes (*"where was I?"* vs *"what am I working on?"*). They stay parallel.
- **`Board` as a domain entity** distinct from `Project`. Rejected — every project has exactly one board. "Board" was a phantom concept; the project *is* its board.
- **Persistent JSON index alongside the markdown.** Rejected — same data in two stores invites drift. The in-memory parsed representation is enough; the markdown file is canonical.
- **URL-friendly `slug` field on `Project` (e.g. `/projects/kolu`).** Rejected — slug-collisions force fallback to UUID, meaning UUID was always the identity and slug was a display label wearing identity clothes. Three failure modes vanish at once: rename-breaks-bookmarks, URL-drifts-from-name, slug-collision-fallback. URLs use `Project.id` directly; the display name lives in the page title and breadcrumb separately.
- **Project navigation tracked in `preferences.activeProject`.** Rejected — the URL is the only canonical answer to "which project am I on." A second store invites drift on reload, deep-link, and palette-driven selection. Preferences keeps orthogonal pane-chrome state (right-panel collapse, tab); navigation lives in the route.
- **Card detail view (modal/page/drawer opened on click).** Rejected — the card itself shows everything important, and inline edit covers field changes. Adding a detail view duplicates information already on the card and invents a new presentation pattern kolu doesn't have today.
- **Single `ProjectModal` (or `TaskModal`) handling create + edit via an `isEdit` flag.** Rejected — create and edit have different validation rules (name-uniqueness across all vs. all-but-self), different side-effects (rename-triggers-board-move), and will diverge further. Two modals sharing a stateless field component avoids the internal branching.
- **Persisting card expand/collapse state.** Rejected — markdown placement causes layout twitches on hand-edit; preferences placement creates an unbounded `Record<TaskId, boolean>` that leaks entries for deleted tasks. Session-only state with a "long descriptions start collapsed" heuristic answers the user need without storing anything.
- **Right-click context menu replacing the card affordances.** Rejected — kolu has no right-click context menu pattern today (the pill tree is read-only, terminal tiles use direct-click affordances). Inline-edit on click is well-precedented (Notion, Obsidian, Linear) and keeps the kanban interaction model close to obsidian-kanban's.
- **Stored `createdAt` and `completedAt` fields on `Task`.** Rejected. `createdAt` isn't recoverable from the markdown after a few lane moves — the file is canonical, and we'd be lying about the precision if we stored a value the source couldn't back up. `completedAt` is a derivation from `(task, currentLane)` — *if the lane has the `complete` role, `updatedAt` is the completion time; otherwise it's not done.* Storing it as an independent field invites drift between the lane and the field, and "first-completion-immutable" semantics cost us the honesty that re-completing a task re-stamps the date. Single timestamp; lane-membership encodes the rest.
- **Hidden `c=` / `u=` / `d=` timestamps inside the block-id comment.** Considered — would have stored all three timestamps invisibly per task. Rejected once the single-`updatedAt` model landed, since two of the three storage slots had nothing to fill them with. The visible `@{YYYY-MM-DD}` annotation on each task line is the simpler outcome.

## Open questions

- **Default lanes on first project creation.** Probably `Todo`, `Doing`, `Done` (with `Done` flagged `**Complete**`). Worth confirming on review or shipping a default the user can immediately edit.
- **"No Project" UX.** Pin to top of the project picker? Hide until it has tasks? Always show with a distinct treatment? Open.
- **Visual treatment of completion timestamp annotations** (`@{2026-04-20}`) inside the markdown. Inline, sidebar, hover-only? Open.

## Out of scope

These are deliberate exclusions:

- **Project-management features.** No assignees, due dates, priorities, dependencies, blockers, sprints, milestones, recurring tasks. This is a personal kanban, not a tracker.
- **Gantt charts and time-bound planning views.** Adding `startsAt` / `endsAt` would expand the task object well beyond "intent metadata".
- **Agent-driven autonomous mutation.** Agents observing terminal/agent state and writing to tasks without user action remains banned. Per-agent completion volatility (Claude Code's TaskCreate, OpenCode's todo SQLite) stays inside `packages/integrations/anyagent/src/agent-provider.ts`. The UI may show "agent thinks this is done" as a passive read-only affordance; it never writes.
- **Programmatic mutation surface for user-invoked clients.** A way for the user to mutate tasks from outside the Kolu UI — via an MCP server, a CLI, an agent tool, a plugin host, or some other shape — is anticipated as a future addition. The form, trust model, and auth design are all undecided. Out of scope for this proposal; deserves its own.
- **Replacing `recentRepos`.** That auto-MRU stays untouched. A user opening a recent repo without ever creating a Project for it should keep working exactly as today.
- **Board format interop with non-Obsidian tools** beyond what falls out of mirroring obsidian-kanban's syntax. No adapters, no bidirectional sync to other task systems.
- **Persisting card expand/collapse state.** Heuristic (description length) determines the default; the user's toggle lives in session memory only. Reload is a clean slate by design.
- **Project deletion from inside Kolu.** Archive (via `archived: true`) is the in-app affordance. Permanent deletion is a manual filesystem operation under `~/.config/kolu/projects/`. Adding an in-app delete affordance with confirmation flows is a separate proposal.
- **Drag-to-trash zone for task deletion.** Considered, deferred. It's discoverable on mobile but eats real estate on the small fullscreen viewport. The card-corner ✕ works on both desktop and mobile; revisit drag-to-trash if usage data shows people prefer dragging.
- **First-completion-immutable timestamps and cycle-time analytics.** Moving a task out of Done and back in re-stamps `updatedAt`; the original completion date is not preserved. "How long did task X take?" / "what's our average cycle time?" / "completed-on history" are project-management questions and stay out of scope. The deliberate trade is honesty in the schema: storing a timestamp we'd silently overwrite would lie to users about what the field means.
- **Per-task version field.** The on-disk format carries `kolu-board: vN` once at the top of the file; individual tasks have no version of their own. Adding optional fields later is handled by the migration ladder, not by per-record versioning.
