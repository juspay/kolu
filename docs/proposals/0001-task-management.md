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

### Tasks

Pure intent metadata. A task is a labeled bookmark of "what I was working on."

```ts
type Task = {
  id: string;             // kolu-managed; encoded as a hidden block-id in markdown
  projectId: string;      // mandatory; floating tasks live under the synthetic "No Project"
  name: string;           // user-typed
  description?: string;   // user-typed; freeform markdown
  createdAt: number;
  updatedAt: number;
  completedAt?: number;   // set on first entry into a `**Complete**` lane; immutable once set
};
```

Notably **absent**: a `status` field. The lane a task lives in *is* its status. Carrying `status` on the task object would be a denormalization of lane membership and would require two writes for every state change. Status is computed at read time from "which lane currently contains this task."

`completedAt` semantics: **first-completion, immutable**. Set once when a task first lands in a lane flagged as completion. Moving it back out does not clear it. Moving back in does not update it. Re-opening a "completed" task is a separate concept that this proposal deliberately does not model.

### Lanes

User-defined per project. A lane is just a heading in the project's markdown file; the lane name is whatever the user typed. Two projects can both have lanes named "Done", or one called "🔥 fires" and another "Reading" — the system imposes no vocabulary.

A lane can carry a `complete` *role* (zero or one role today; the schema leaves room for more — see Out of scope). A lane with the `complete` role is treated as the "done" column: tasks landing there get a `completedAt` timestamp.

### Creating a task

There is **one underlying operation** — `createTask(input)` — invoked through two affordances:

- **Per-lane "+ add task"** — an inline input at the bottom of each lane on the project board. Project and lane are inferred from context; the user types only a title. Fast path for "drop a thought into the right column."
- **Command palette → "New task"** — a modal asking project, lane, title, description. Lane defaults to the project's first lane; project defaults to the last-active project (or "No Project"). Slower, more deliberate path; works from anywhere, including with no project open.

Both affordances pre-fill different subsets of the same input shape. They share the write path. There is no `createTaskInline` and `createTaskModal` — only `createTask`.

### The project board (per project)

The primary view for working *inside* a project. Lanes laid out left-to-right; tasks shown as cards within. Cards expose:

- Title
- Optional description preview
- Linked terminal pills (if any terminals are tagged to this task)
- A check + completion timestamp when the lane carries the `complete` role

Cards are dragged between lanes to change status; the `+ add task` affordance lives at the bottom of each lane.

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

- [ ] Fix login bug <!-- ^abc123 -->
- [ ] Refactor session module <!-- ^def456 -->
  Splits the auth and session storage modules.

## Doing

- [ ] Learn CRDTs <!-- ^ghi789 -->

## Done

**Complete**

- [x] Set up dev env <!-- ^jkl012 --> @{2026-04-20}
```

Conventions:

- `## LaneName` — heading is the lane.
- `**Complete**` immediately under a heading flags the lane with the `complete` role (matches obsidian-kanban exactly).
- `- [ ]` / `- [x]` items are tasks. Checkbox state is decorative; lane membership is canonical.
- `<!-- ^id -->` HTML comments hold task block-ids. Hidden in rendered markdown so users don't accidentally clobber them while editing.
- `@{2026-04-20}` is a completion timestamp annotation written by Kolu when a task enters a `complete` lane.

The file is **plain markdown**. Kolu is the primary editor, but users can hand-edit in any tool. Kolu watches for filesystem changes and reparses on update. Last-write-wins conflict resolution; reasonable for a personal-use feature.

**Default location**: `~/.config/kolu/projects/<projectId>/board.md` — alongside Kolu's other state. Survives Kolu uninstall/reinstall as a single directory copy; doesn't pollute the user's repo. Two distinct user populations are concretely known to exist:

1. *Tool-managed* — the default. Kolu owns storage; user doesn't version it.
2. *Git-versioned* — board lives at `<repoPath>/.kolu/board.md`, committed alongside code.

Both populations are real today. The default covers (1); the implementation should leave the path-resolution layer pluggable so (2) can be added without schema reshaping.

## Prototype

See [`./0001-task-management/mockup.html`](./0001-task-management/mockup.html) — open in a browser. Five views:

1. **Per-project board** — lanes, cards, terminal pills, completion check.
2. **What's on disk** *(explanation only)* — the raw markdown that produces view 1, rendered side-by-side. Not a proposed Kolu surface; included to make the file format concrete.
3. **Cross-project view** — time-ordered table.
4. **Terminal canvas with task tags** — existing canvas; one new title-bar affordance.
5. **Creation UI** *(proposed)* — per-lane inline `+ add` and the command-palette `New task` modal.

## Implementation notes

Optional pointers, not prescriptions:

- Block-IDs (`^abc123`) are kolu-managed and must be invisible to the user — store them in HTML comments so hand-edits don't clobber them.
- The path-resolution layer that maps `(projectId) → board.md path` should be small and replaceable. The default implementation returns `~/.config/kolu/projects/<id>/board.md`; a future per-project `boardPath` override (for git-versioned boards) plugs into the same seam.
- The synthetic "No Project" container is identified by a single reserved UUID constant. Display rendering substitutes the label "No Project"; storage and code paths treat it like any other project.

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
